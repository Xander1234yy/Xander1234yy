import path from "node:path";
import { loadConfig } from "./config";
import { readFileOrNull } from "./fs-utils";
import { rotateToken, TOKEN_FILE } from "./identity";

const [cmd, sub] = process.argv.slice(2);
const config = loadConfig();

if (cmd === "token" && sub === "rotate") {
  await rotateToken(config.dataDir);
  console.log("Nieuw connector-token aangemaakt. Herstart de connector en de webapp.");
} else if (cmd === "token") {
  const file = path.join(config.dataDir, TOKEN_FILE);
  const t = await readFileOrNull(file);
  console.log(t ? `Tokenbestand: ${file}\n(Inhoud wordt niet getoond. Gebruik 'token rotate' om te vernieuwen.)` : "Nog geen token. Start eerst de connector.");
} else {
  console.log("Gebruik: npm run token -w @homeos/connector [-- rotate]");
}
