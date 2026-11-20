import dgram from "node:dgram";
import { isPrivateLanHost } from "../hue/net";

export interface DiscoveredTv {
  host: string;
  name: string | null;
}

const ST = "urn:lge-com:service:webos-second-screen:1";

/** Parseert een SSDP-antwoord van een LG webOS-tv. */
export function parseSsdpResponse(text: string, from: string): DiscoveredTv | null {
  if (!/^HTTP\/1\.1 200/i.test(text) || !text.toLowerCase().includes("webos-second-screen")) return null;
  const headers = new Map<string, string>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
  }
  let host = from;
  try {
    const loc = headers.get("location");
    if (loc) host = new URL(loc).hostname;
  } catch {
    /* LOCATION ongeldig: gebruik afzender */
  }
  if (!isPrivateLanHost(host)) return null;
  let name: string | null = null;
  const raw = headers.get("dlnadevicename.lge.com");
  if (raw) {
    try {
      name = decodeURIComponent(raw).slice(0, 80);
    } catch {
      name = raw.slice(0, 80);
    }
  }
  return { host, name };
}

/** Zoekt webOS-tv's op het lokale netwerk via SSDP (multicast, niets gaat naar internet). */
export function discoverTvs(timeoutMs = 3000): Promise<DiscoveredTv[]> {
  return new Promise((resolve) => {
    const found = new Map<string, DiscoveredTv>();
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => {
      try {
        socket.close();
      } catch {
        /* al dicht */
      }
      resolve([...found.values()]);
    };
    socket.on("message", (msg, rinfo) => {
      const tv = parseSsdpResponse(msg.toString("utf8"), rinfo.address);
      if (tv && !found.has(tv.host)) found.set(tv.host, tv);
    });
    socket.on("error", finish);
    socket.bind(() => {
      const req = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${ST}\r\n\r\n`);
      socket.send(req, 1900, "239.255.255.250");
      setTimeout(() => socket.send(req, 1900, "239.255.255.250"), 500).unref?.();
      setTimeout(finish, timeoutMs).unref?.();
    });
  });
}
