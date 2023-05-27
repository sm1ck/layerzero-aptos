import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as stream from "stream";
import { once } from "events";

const __dirname = path.resolve();

export const importETHWallets = async () => {
  let accs = [];
  let instream = fs.createReadStream(path.join(__dirname, "./privates.txt"));
  let outstream = new stream.Stream();
  let rl = readline.createInterface(instream, outstream);
  rl.on("line", (line) => {
    accs.push(line);
  });
  await once(rl, "close");
  return accs;
};

export const importAptosWallets = async () => {
  let accs = [];
  let instream = fs.createReadStream(
    path.join(__dirname, "./aptos_privates.txt")
  );
  let outstream = new stream.Stream();
  let rl = readline.createInterface(instream, outstream);
  rl.on("line", (line) => {
    accs.push(line);
  });
  await once(rl, "close");
  return accs;
};
