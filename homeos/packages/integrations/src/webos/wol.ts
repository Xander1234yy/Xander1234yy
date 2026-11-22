import dgram from "node:dgram";

/** Wake-on-LAN "magic packet": 6× 0xFF gevolgd door 16× het MAC-adres. */
export function magicPacket(mac: string): Buffer {
  const hex = mac.replace(/[:-]/g, "");
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) throw new Error("Ongeldig MAC-adres");
  const bytes = Buffer.from(hex, "hex");
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array.from({ length: 16 }, () => bytes)]);
}

/** Broadcastadres van een /24-netwerk (de gebruikelijke thuissituatie), plus het algemene broadcastadres. */
export function broadcastTargets(host: string): string[] {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(host);
  return m ? [`${m[1]}.${m[2]}.${m[3]}.255`, "255.255.255.255"] : ["255.255.255.255"];
}

export type WolSender = (mac: string, host: string) => Promise<void>;

/** Verstuurt het pakket alleen op het lokale netwerk (UDP-poort 9, broadcast). */
export const sendWakeOnLan: WolSender = (mac, host) =>
  new Promise((resolve, reject) => {
    const packet = magicPacket(mac);
    const socket = dgram.createSocket("udp4");
    socket.once("error", (e) => {
      socket.close();
      reject(e);
    });
    socket.bind(() => {
      socket.setBroadcast(true);
      const targets = broadcastTargets(host);
      let left = targets.length * 2;
      const done = () => {
        if (--left === 0) {
          socket.close();
          resolve();
        }
      };
      // Twee keer per adres: UDP kan pakketten verliezen.
      for (const t of targets) for (let i = 0; i < 2; i++) socket.send(packet, 9, t, done);
    });
  });
