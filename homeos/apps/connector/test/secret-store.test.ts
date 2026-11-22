import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SecretStore } from "../src/secret-store";
import { tempDir } from "./helpers";

describe("SecretStore", () => {
  it("versleutelt secrets en scheidt adapters", async () => {
    const dir = await tempDir();
    const store = new SecretStore(dir, null);
    const hue = store.scoped("hue");
    const plug = store.scoped("plug");
    await hue.set("appKey", "super-geheime-hue-sleutel");
    expect(await hue.get("appKey")).toBe("super-geheime-hue-sleutel");
    expect(await plug.get("appKey")).toBeNull();
    const raw = await readFile(path.join(dir, "secrets.enc"), "utf8");
    expect(raw).not.toContain("super-geheime");
    // nieuwe instantie leest dezelfde gegevens terug
    expect(await new SecretStore(dir, null).scoped("hue").get("appKey")).toBe("super-geheime-hue-sleutel");
    await hue.delete("appKey");
    expect(await hue.get("appKey")).toBeNull();
    await rm(dir, { recursive: true, force: true });
  });

  it("kan niet ontsleutelen met een andere sleutel", async () => {
    const dir = await tempDir();
    await new SecretStore(dir, "a".repeat(40)).scoped("x").set("k", "v");
    await expect(new SecretStore(dir, "b".repeat(40)).scoped("x").get("k")).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});
