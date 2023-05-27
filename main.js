import Web3 from "web3";
import ethers from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as accs from "./accs.js";
import { exit } from "process";
import * as aptos from "aptos";

/**
 * Случайное min/max дробное значение
 * @param {Float} min
 * @param {Float} max
 * @param {Integer} decimalPlaces
 * @returns Случайное число
 */
const randomInRange = (min, max, decimalPlaces) => {
  let rand = Math.random() * (max - min) + min;
  let power = Math.pow(10, decimalPlaces);
  return Math.floor(rand * power) / power;
};

/**
 * Абстрактная задержка (async)
 * @param {Integer} millis
 * @returns
 */

const sleep = async (millis) =>
  new Promise((resolve) => setTimeout(resolve, millis));

/**
 * Случайное min/max целое значение
 * @param {Integer} min
 * @param {Integer} max
 * @returns Случайное число
 */

export const randomIntInRange = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const claimCoinPayload = () => {
  return {
    function: `0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::coin_bridge::claim_coin`,
    type_arguments: [
      `0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::WETH`,
    ],
    arguments: [],
  };
};

const getBalance = async (address) => {
  try {
    const resource = await aptos_client.getAccountResource(
      address,
      `0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>`
    );
    const c = resource.data.coin.value;
    return BigInt(c);
  } catch (error) {
    return BigInt(0);
  }
};

const sendAndConfirmTransaction = async (account, payload) => {
  const options = await estimateGas(account, payload);
  const txnRequest = await aptos_client.generateTransaction(
    account.address(),
    payload,
    options
  );
  const signedTxn = await aptos_client.signTransaction(account, txnRequest);
  const res = await aptos_client.submitTransaction(signedTxn);
  return res.hash;
};

const applyGasLimitSafety = (gasUsed) =>
  (BigInt(gasUsed) * BigInt(10000 + GAS_LIMIT_SAFETY_BPS)) / BigInt(10000);

const estimateGas = async (account, payload) => {
  const txnRequest = await aptos_client.generateTransaction(
    account.address(),
    payload
  );
  const sim = await aptos_client.simulateTransaction(account, txnRequest, {
    estimateGasUnitPrice: true,
    estimateMaxGasAmount: true,
  });
  const tx = sim[0];
  const max_gas_amount = applyGasLimitSafety(tx.gas_used).toString();
  return {
    max_gas_amount,
    gas_unit_price: tx.gas_unit_price,
  };
};

const checkGas = async (j, address) => {
  while (true) {
    let baseFee = (await web3.eth.getBlock("latest")).baseFeePerGas;
    let current_gas = Number(web3.utils.fromWei(String(baseFee), "gwei"));
    if (current_gas >= eth_max_gwei) {
      console.log(
        `(LayerZero-Aptos #${j}) => ${address}: слишком высокий газ (${current_gas} gwei), ожидаем..`
      );
      await sleep(60000);
    } else {
      return baseFee;
    }
  }
};

// main send function

const sendETHToAptos = async (wallets, aptos_wallets, j) =>
  new Promise(async (resolve, reject) => {
    const wallet = web3.eth.accounts.privateKeyToAccount(wallets[j]);
    try {
      const aptos_account = new aptos.AptosAccount(
        Uint8Array.from(Buffer.from(aptos_wallets[j].replace("0x", ""), "hex"))
      );
      const aptos_wallet = aptos_account.address().hex();
      const amount_bridge = randomInRange(rnd_min, rnd_max, 6);
      let baseFee = await checkGas(j, wallet.address);
      console.log(
        `(LayerZero-Aptos #${j}) => ${wallet.address}: отправка ${amount_bridge} ETH на ${aptos_wallet}`
      );
      let _callParams = [wallet.address, zeroAddress];
      let adapterParams = ethers.utils.solidityPack(
        ["uint16", "uint256", "uint256", "bytes"],
        [2, aptos_gas, aptos_airdrop, aptos_wallet]
      );
      let result = await contract.methods
        .quoteForSend(_callParams, adapterParams)
        .call();
      let nativeFee = result.nativeFee;
      console.log(
        `(LayerZero-Aptos #${j}) => ${
          wallet.address
        }: комиссия моста -> ${web3.utils.fromWei(String(nativeFee))} ETH`
      );
      let bal_eth = await web3.eth.getBalance(wallet.address);
      let want_to_send = web3.utils.toWei(String(amount_bridge), "ether");
      let numberOfTokens = ethers.BigNumber.from(want_to_send).add(nativeFee);
      let gas = await contract.methods
        .sendETHToAptos(aptos_wallet, want_to_send, _callParams, adapterParams)
        .estimateGas({
          from: wallet.address,
          value: numberOfTokens.toString(),
        });
      let minETHNeed = ethers.BigNumber.from(gas)
        .mul(ethers.BigNumber.from(baseFee))
        .add(maxPriorityFeePerGas)
        .add(ethers.BigNumber.from(numberOfTokens)); // remove * 2
      if (ethers.BigNumber.from(bal_eth).gt(minETHNeed)) {
        let tx = {
          from: wallet.address,
          to: layerzero_aptos,
          gas: gas,
          maxPriorityFeePerGas: maxPriorityFeePerGas,
          maxFeePerGas: ethers.BigNumber.from(baseFee)
            .add(maxPriorityFeePerGas)
            .toString(),
          value: numberOfTokens.toString(),
          data: await contract.methods
            .sendETHToAptos(
              aptos_wallet,
              want_to_send,
              _callParams,
              adapterParams
            )
            .encodeABI(),
        };
        // Подписываем и отправляем
        let signedTx = await web3.eth.accounts.signTransaction(tx, wallets[j]);
        web3.eth
          .sendSignedTransaction(signedTx.rawTransaction)
          .on("transactionHash", async (hash) => {
            console.log(
              `(LayerZero-Aptos #${j}) => ${wallet.address}: транзакция отправлена -> ${explorer}/tx/${hash}`
            );
            if (!isClaim) {
              console.log(
                `(LayerZero-Aptos #${j}) => ${aptos_wallet}: не производим клейм..`
              );
              return resolve();
            }
            console.log(
              `(LayerZero-Aptos #${j}) => ${aptos_wallet}: ожидаем депозит в aptos..`
            );
            const bal_cache = await getBalance(aptos_account.address());
            while (true) {
              const bal = await getBalance(aptos_account.address());
              if (bal > bal_cache) {
                const tx_hash = await sendAndConfirmTransaction(
                  aptos_account,
                  claimCoinPayload()
                );
                console.log(
                  `(LayerZero-Aptos #${j}) => ${aptos_wallet}: клейм weth -> https://explorer.aptoslabs.com/txn/${tx_hash}`
                );
                return resolve();
              } else {
                await sleep(60000);
              }
            }
          })
          .on("error", async (error) => {
            if (error?.message.includes("insufficient funds")) {
              console.log(
                `(LayerZero-Aptos #${j}) => ${wallet.address}: недостаточно средств.`
              );
              resolve();
            } else {
              console.log(
                `(LayerZero-Aptos #${j}) => ${wallet.address}: ошибка ->`
              );
              console.dir(error);
              await sleep(60000); // 1 min to prevent spam
              return await sendETHToAptos(wallets, aptos_wallets, j);
            }
          });
      } else {
        console.log(
          `(LayerZero-Aptos #${j}) => ${wallet.address}: недостаточный баланс кошелька.`
        );
        resolve();
      }
    } catch (err) {
      if (err?.message.includes("insufficient funds")) {
        console.log(
          `(LayerZero-Aptos #${j}) => ${wallet.address}: недостаточно средств.`
        );
        resolve();
      } else {
        console.log(`(LayerZero-Aptos #${j}) => ${wallet.address}: ошибка ->`);
        console.dir(err);
        await sleep(60000); // 1 min to prevent spam
        return await sendETHToAptos(wallets, aptos_wallets, j);
      }
    }
  });

// Базовые переменные

const isSleep = true; // задержка перед отправкой, нужна ли? изменить на true, если нужна
const sleep_from = 60; // от 60 секунд
const sleep_to = 3000; // до 60 секунд
const rnd_min = 0.001; // min eth bridge
const rnd_max = 0.002; // max eth bridge
const maxPriorityFeePerGas = 1500000000; // 1.5 gwei, можно поменять tip для майнеров
const aptos_gas = 10000; // aptos gas default is 10000
const aptos_airdrop = 520400; // мы отслеживаем получение аирдропа и клеймим..
const zeroAddress = "0x0000000000000000000000000000000000000000";
const GAS_LIMIT_SAFETY_BPS = 2000; // aptos
const eth_max_gwei = 30; // макимальное значение gwei при котором скрипт уйдет в ожидание
const net_id = 42161; // 1 => eth, 42161 => arb
const isClaim = true; // если мы шлем на тот же адрес аптоса во второй и более раз, нужно ставить false

// rpc
const web3_select = {
  1: new Web3(
    "wss://eth-mainnet.g.alchemy.com/v2/MAiLCz0L2XqKTGCK6ubIfxYqLFZZsmQF"
  ),
  42161: new Web3(
    "wss://arb-mainnet.g.alchemy.com/v2/a3gddyg-QZsrorLULTsvQACmRtXb-exh"
  ),
};
// explorer
const explorer_select = {
  1: "https://etherscan.io",
  42161: "https://arbiscan.io",
};
// layezero-aptos bridge contract
const contract_select = {
  1: "0x50002cdfe7ccb0c41f519c6eb0653158d11cd907",
  42161: "0x1BAcC2205312534375c8d1801C27D28370656cFf",
};
const web3 = web3_select[net_id];
const layerzero_aptos = contract_select[net_id];
const explorer = explorer_select[net_id];

// file names
const __dirname = path.resolve();

const LAYERZERO_APTOS_ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, "/LAYERZERO_APTOS_ABI.json"), "utf8")
);
const contract = new web3.eth.Contract(LAYERZERO_APTOS_ABI, layerzero_aptos);
// aptos
const aptos_client = new aptos.AptosClient(
  "https://fullnode.mainnet.aptoslabs.com"
);
// Основной цикл, отправка eth..
let wallets = await accs.importETHWallets();
let aptos_wallets = await accs.importAptosWallets();

for (let j = 0; j < wallets.length; j++) {
  await sendETHToAptos(wallets, aptos_wallets, j);
  if (isSleep && j < wallets.length - 1) {
    let sle = randomIntInRange(sleep_from, sleep_to);
    console.log(`(LayerZero-Aptos #${j}) => задержка ${sle}с..`);
    await sleep(sle * 1000);
  }
}
exit();
