import fs from "fs/promises";
import * as d3 from "d3";
import util from "util";
import { exec } from "child_process";
import { fileURLToPath } from 'url';
import path from "path";
import { extractTables } from '@krakz999/tabula-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tabulaPath = path.join(__dirname, 'tabula-1.0.5-jar-with-dependencies.jar');
const asyncExec = util.promisify(exec);

export async function parseDKB(path) {
  const csv = (await fs.readFile(path, "utf8")).split("\n").slice(4).join("\n");
  const transactions = d3.dsvFormat(";").parse(csv, (d) => {
    var entry = {
      date: d3.timeFormat("%Y-%m-%d")(
        d3.timeParse("%d.%m.%y")(d["Wertstellung"])
      ),
      notes: d["Verwendungszweck"],
    };
    if (d["Umsatztyp"] == "Eingang") {
      entry.payee_name = d["Zahlungspflichtige*r"];
      entry.amount = Math.round(parseFloat(d["Betrag (€)"]) * 100);
    }
    else {
      entry.payee_name = d["Zahlungsempfänger*in"];
      entry.amount = Math.round(parseFloat(d["Betrag (€)"]) * 100);
    }
    return entry;
  })
  return transactions;
}

export async function parseZKB(path) {
  const csv = await fs.readFile(path, "utf8");
  var last_date = null;
  var sign = 1;
  const transactions = d3.dsvFormat(";").parse(csv, (d) => {
    if (d["Value date"] != "") {
      last_date = d3.timeFormat("%Y-%m-%d")(
        d3.timeParse("%d.%m.%Y")(d["Value date"])
      );
      sign = d["Credit CHF"] != "" ? 1 : -1;
    }
    if (
      d["Booking text"].startsWith("Debit eBanking Mobile (") ||
      d["Booking text"].startsWith("Credit eBanking Mobile (") ||
      d["Booking text"].startsWith("Debit Standing order (")
    )
      return null;
    var amount =
      parseFloat(d["Amount details"]) * sign ||
      parseFloat(d["Credit CHF"]) ||
      -parseFloat(d["Debit CHF"]);
    return {
      date: last_date,
      payee_name: d["Booking text"],
      amount: Math.round(amount * 100),
      notes: d["Payment purpose"] + " " + d["Details"],
    };
  });

  return transactions;
}

export async function parseInteractiveBrokers(path) {
  const csv = await fs.readFile(path, "utf8");
  const csvlines = csv
    .split("\n")
    .filter((line) => line.includes("Electronic Fund Transfer"));
  const transactions = csvlines.map((line) => {
    const fields = line.split(",");
    return {
      date: fields[3],
      amount: parseInt(fields[5]) * 100,
      payee_name: fields[4],
    };
  });
  return transactions;
}

export async function parseZKBOne(file) {
  if (!file.endsWith(".pdf")) return [];
  console.log(`Parsing ${file} with ZKBOne parser`)
  const csv = await extractTables(file, {
    pages: "all",
    columns: "132,400,480,520"
  });
  /*await asyncExec(
    `java -jar ${tabulaPath} "${file}" -c 132,400,480,520 --pages all -o "${file}-temp.csv"`
  );
  const csv = await fs.readFile(`${file}-temp.csv`, "utf8");*/
  const rowParser = (d) => {
    const regex = /\b\d{2}\.\d{2}\.\d{2} \d{2}\.\d{2}\.\d{2}\b/;
    if (!d[0].match(regex)) return null;
    const sign = d[4].includes("-") ? 1 : -1;
    return {
      date: d3.timeFormat("%Y-%m-%d")(
        d3.timeParse("%d.%m.%y")(d[0].split(" ")[0])
      ),
      payee_name: d[1],
      amount: Math.round(sign * parseFloat(d[4].replace("'", "")) * 100),
    };
  };
  const transactions = d3.csvParseRows(csv, rowParser);
  //await fs.unlink(`${file}-temp.csv`); // delete the temp file
  return transactions;
}

export async function parseCembra(path) {
  if (!path.endsWith(".pdf")) return [];
  const csv = await extractTables(path, {
    pages: "all",
    columns: "129,201,408,480"
  });
  /*await asyncExec(
    `java -jar ${tabulaPath} ${path} --pages all -c 129,201,408,480 -o ${path}-temp.csv`
  );
  const csv = await fs.readFile(`${path}-temp.csv`, "utf8");*/
  const rowParser = (d) => {
    if (!d[1].match(/\d{2}.\d{2}.\d{4}/)) return null;
    if (d[3] == "" && d[4] == "") return null;
    return {
      date: d3.timeFormat("%Y-%m-%d")(d3.timeParse("%d.%m.%Y")(d[1])),
      payee_name: d[2],
      amount: Math.round(
        (parseFloat(d[3].replace(/'/g, "")) ||
          -parseFloat(d[4].replace(/'/g, ""))) * 100
      ),
    };
  };
  return d3.csvParseRows(csv, rowParser);
}

export async function parseCreditSuisseCredit(file) {
  const csv = await fs.readFile(file, "utf8");
  const rowParser = (d) => ({
    date: d3.timeFormat("%Y-%m-%d")(
      d3.timeParse("%d.%m.%Y")(d["Transaction date"])
    ),
    payee_name: d["Description"],
    amount: -Math.round(parseFloat(d["Amount"]) * 100),
    notes: d.Category,
  });
  const transactions = d3.csvParse(csv, rowParser);
  return transactions;
}

export async function parseCreditSuisse(file) {
  const csv = await fs.readFile(file, "utf8");
  const csvstr = csv.split("\n").slice(5, -1).join("\n");
  const rowParser = (d) => {
    var entry = {
      date: d3.timeFormat("%Y-%m-%d")(
        d3.timeParse("%d.%m.%Y")(d["Booking Date"])
      ),
      payee_name: d["Text"],
      amount: Math.round(
        (parseFloat(d["Credit"]) || -parseFloat(d["Debit"])) * 100
      ),
    };
    entry.notes = entry.payee_name;
    const fields = entry.payee_name.split(",");
    if (
      [
        "Payment QR-bill ",
        "Direct debit collection ",
        "Clearing payment ",
        "Payment order ",
        "Payment domestic - ISR ",
        "Internal Book Transfer ",
      ].includes(fields[0])
    )
      entry.payee_name = fields[1];
    else if (["TWINT Payment ", "TWINT Credit "].includes(fields[0])) {
      if (fields[2].startsWith("vom")) entry.payee_name = fields[1];
      else entry.payee_name = fields.slice(1, 3).join(", ");
    } else if (
      fields.length == 1 ||
      fields[0].includes("withdrawal") ||
      fields[0] == "Balance of closing entries "
    )
      entry.payee_name = fields[0];
    else if (fields[0] == "Debit card point of sale payment CHF ")
      entry.payee_name = fields[2];
    else if (fields[0] == "SEPA payment outgoing ") {
      entry.payee_name = fields[4];
    } else entry.payee_name = fields[0];
    return entry;
  };

  const transactions = d3.csvParse(csvstr, rowParser);
  return transactions;
}
