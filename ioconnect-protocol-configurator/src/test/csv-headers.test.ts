import { describe, it, expect } from "vitest";
import { parseCSV, toCSVWithSchema, toCSV } from "../lib/csv-headers";
import type { CSVColumnDescriptor } from "../lib/schema-types";

const cols: CSVColumnDescriptor[] = [
  { key: "device", label: "Device", widget: "text" },
  { key: "address", label: "Address", widget: "text" },
  { key: "tag", label: "Tag", widget: "text" },
];

describe("parseCSV", () => {
  it("parses plain values", () => {
    const { headers, rows } = parseCSV("device,address,tag\ndev1,addr1,tag1");
    expect(headers).toEqual(["device", "address", "tag"]);
    expect(rows[0]).toEqual({ device: "dev1", address: "addr1", tag: "tag1" });
  });

  it("parses a quoted field containing a comma", () => {
    const { rows } = parseCSV('device,address,tag\ndev1,"addr,with,commas",tag1');
    expect(rows[0].address).toBe("addr,with,commas");
  });

  it("parses a quoted field containing a double-quote (escaped as \"\")", () => {
    const { rows } = parseCSV('device,address,tag\ndev1,"addr ""quoted""",tag1');
    expect(rows[0].address).toBe('addr "quoted"');
  });

  it("preserves empty fields", () => {
    const { rows } = parseCSV("device,address,tag\ndev1,,tag1");
    expect(rows[0].address).toBe("");
  });
});

describe("toCSVWithSchema", () => {
  it("does not quote plain values", () => {
    const csv = toCSVWithSchema([{ device: "dev1", address: "addr1", tag: "tag1" }], cols);
    expect(csv).toBe("device,address,tag\ndev1,addr1,tag1");
  });

  it("wraps a value containing a comma in double quotes", () => {
    const csv = toCSVWithSchema([{ device: "dev1", address: "addr,sub", tag: "tag1" }], cols);
    expect(csv).toBe('device,address,tag\ndev1,"addr,sub",tag1');
  });

  it("escapes double-quotes inside a value", () => {
    const csv = toCSVWithSchema([{ device: "dev1", address: 'a"b', tag: "tag1" }], cols);
    expect(csv).toBe('device,address,tag\ndev1,"a""b",tag1');
  });
});

describe("round-trip", () => {
  it("parseCSV(toCSVWithSchema(...)) is identity", () => {
    const original = [
      { device: "dev1", address: "ns=2;s=Some,Tag", tag: 'tag"one' },
      { device: "dev2", address: "plain", tag: "tag2" },
    ];
    const csv = toCSVWithSchema(original, cols);
    const { rows } = parseCSV(csv);
    expect(rows).toEqual(original);
  });
});

describe("toCSV (legacy)", () => {
  it("quotes commas in values", () => {
    const csv = toCSV([
      {
        device: "d", address: "a,b", tag: "t", datatype: "", byteorder: "",
        resolution: "", server: "", lograte: "", isarray: "", arrayindex: "",
      },
    ]);
    expect(csv).toContain('"a,b"');
  });
});
