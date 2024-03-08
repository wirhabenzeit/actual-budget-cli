#! /usr/bin/env -S node --env-file=.env

import api from "@actual-app/api";
import { stat, readdir } from "fs/promises";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { join } from "path";
import * as d3 from "d3";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { confirm, input } from "@inquirer/prompts";

import {
  parseCreditSuisse,
  parseCembra,
  parseCreditSuisseCredit,
  parseInteractiveBrokers,
  parseZKB,
  parseZKBOne,
  parseDKB
} from "./parser.mjs";

const parsers = {
  "Credit Suisse": parseCreditSuisse,
  Cembra: parseCembra,
  "Credit Suisse Credit": parseCreditSuisseCredit,
  "Interactive Brokers": parseInteractiveBrokers,
  ZKB: parseZKB,
  "ZKB One": parseZKBOne,
  DKB: parseDKB,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

var actualAPI = (function () {
  var transactions;
  var accounts;
  var accountsByName;
  var accountsByID;
  var payees;
  var payeesByName;
  var payeesByID;
  var categories;
  var categoriesByName;
  var categoriesByID;
  var categoryGroupIDs;
  const incomeID = "2E1F5BDB-209B-43F9-AF2C-3CE28E380C00";

  const getTransactions = async () => {
    transactions = await api.getTransactions();
  };

  const getAccounts = async () => {
    accounts = await api.getAccounts();
    accountsByName = Object.fromEntries(
      accounts.map((account) => [account.name, account]),
    );
    accountsByID = Object.fromEntries(
      accounts.map((account) => [account.id, account]),
    );
  };

  const getAccount = ({ name, id }) =>
    name ? accountsByName[name] : id ? accountsByID[id] : null;

  const getCategories = async () => {
    categories = await api.getCategories();
    categoriesByName = Object.fromEntries(categories.map((c) => [c.name, c]));
    categoriesByID = Object.fromEntries(categories.map((c) => [c.id, c]));
    categoryGroupIDs = Array.from(new Set(categories.map((c) => c.group_id)));
  };

  const getCategory = ({ name, id }) =>
    name ? categoriesByName[name] : id ? categoriesByID[id] : null;

  const getPayees = async () => {
    payees = await api.getPayees();
    payeesByName = Object.fromEntries(payees.map((p) => [p.name, p]));
    payeesByID = Object.fromEntries(payees.map((p) => [p.id, p]));
  };

  const getPayee = ({ name, id }) =>
    name ? payeesByName[name] : id ? payeesByID[id] : null;

  const nameToId = (d) => {
    const { transfer, category, ...entry } = {
      ...d,
      account: accountsByName[d.account].id,
    };
    if (category) entry.category = categoriesByName[category].id;
    if (transfer) entry.payee = payeesByName[transfer].id;
    return entry;
  };

  const IdToName = (d) => ({
    ...d,
    account: accountsByID[d.account].name,
    category: d.category ? categoriesByID[d.category].name : null,
    payee_name: payeesByID[d.payee].name,
    ...("transfer_id" in d && { transfer: payeesByID[d.payee].name }),
  });

  return {
    init: async (sync_id) => {
      console.log(
        `Initializing API for ${sync_id} on ${process.env.SERVER_URL}`,
      );
      await api.init({
        serverURL: process.env.SERVER_URL,
        password: process.env.SERVER_PASSWORD,
        dataDir: path.join(__dirname, "temp"),
      });
      await api.downloadBudget(sync_id);
      await getAccounts();
      await getPayees();
      await getCategories();
      await getTransactions();
    },
    deleteCategories: async () => {
      const categoryPromises = categories.map((category) =>
        api.deleteCategory(category.id),
      );
      const groupPromises = Array.from(categoryGroupIDs).map((group) => {
        if (group !== incomeID) api.deleteCategoryGroup(group);
      });
      await Promise.all([...categoryPromises, ...groupPromises]);
      await getCategories();
    },
    setupCategories: async (newCategories) => {
      let groupNames = Array.from(new Set(newCategories.map((c) => c.group)));
      let groupIDsPromise = groupNames.map((group) =>
        group === "Income"
          ? new Promise((resolve) => resolve(incomeID))
          : api.createCategoryGroup({ name: group }),
      );
      let groupIDs = await Promise.all(groupIDsPromise);
      groupIDs = Object.fromEntries(
        groupNames.map((group, i) => [group, groupIDs[i]]),
      );
      await Promise.all(
        newCategories.map((category) =>
          api.createCategory({
            name: category.name,
            group_id: groupIDs[category.group],
            is_income: category.group === "Income",
          }),
        ),
      );
      getCategories();
    },
    deleteAccounts: async () => {
      await Promise.all(
        accounts.map((account) => api.deleteAccount(account.id)),
      );
      getAccounts();
    },
    setupAccounts: async (newAccounts) => {
      const startingBalanceCategory = getCategory({ name: "Starting Balance" });
      console.log("Starting balance category", startingBalanceCategory);
      await Promise.all(
        newAccounts.map((account) =>
          api.createAccount({
            name: account.name,
            type: account.type,
            offbudget: "offbudget" in account,
          }),
        ),
      );
      await getAccounts();
      await Promise.all(
        newAccounts
          .filter((account) => "initial_balance" in account)
          .map((account) =>
            api.importTransactions(getAccount({ name: account.name }).id, [
              {
                account: accountsByName[account.name].id,
                amount: parseInt(100 * account.initial_balance),
                date: "2019-01-01",
                payee_name: "Starting Balance",
                category: startingBalanceCategory.id,
              },
            ]),
          ),
      );
      await getTransactions();
    },
    shutdown: async () => {
      await api.shutdown();
    },
    importTransactions: async (transactionDictionary) => {
      await Promise.all(
        Object.entries(transactionDictionary).map(([account, transactions]) =>
          api.importTransactions(
            getAccount({ name: account }).id,
            transactions.map(nameToId),
          ),
        ),
      );
      await getTransactions();
    },
    updateTransactions: async (transactionDictionary) => {
      await Promise.all(
        Object.entries(transactionDictionary).map(([id, data]) =>
          api.updateTransaction(id, data),
        ),
      );
      await getTransactions();
    },
    deleteTransactions: async () => {
      await Promise.all(
        transactions.map((transaction) =>
          api.deleteTransaction(transaction.id),
        ),
      );
      await getTransactions();
    },
    getTransactions: () => transactions.map(IdToName),
    getCategories: ({ by = null }) =>
      by === "name"
        ? categoriesByName
        : by === "id"
          ? categoriesByID
          : categories,
  };
})();

const monthFilter = ({ month }) => {
  if (month === undefined) return (d) => true;
  else if (month.includes(",")) {
    const [start, end] = month.split(",");
    if (start && end)
      return (d) =>
        d3.timeMonth.floor(new Date(start)) <= new Date(d.date) &&
        new Date(d.date) < d3.timeMonth.ceil(new Date(end));
    else if (start)
      return (d) => d3.timeMonth.floor(new Date(start)) <= new Date(d.date);
    else if (end)
      return (d) => new Date(d.date) < d3.timeMonth.ceil(new Date(end));
    else throw new Error("Invalid month filter");
  } else {
    const date = new Date(month);
    return (d) =>
      d3.timeMonth.floor(date) <= new Date(d.date) &&
      new Date(d.date) < d3.timeMonth.ceil(date);
  }
};

function unique(arr, keyProps) {
  const kvArray = arr.map((entry) => {
    const key = keyProps
      .filter((k) => k in entry)
      .map((k) => entry[k])
      .join("|");
    return [key, entry];
  });
  const map = new Map(kvArray);
  return Array.from(map.values());
}

const readFromFile = async (file) => {
  console.log(`Reading from ${file} with extension ${path.extname(file)}`);
  if (path.extname(file) === ".csv")
    return d3.csvParse(await fs.readFile(file, "utf-8"));
  else if (path.extname(file) === ".json")
    return JSON.parse(await fs.readFile(file, "utf-8"));
  else throw new Error("Invalid file format");
};

const writeToFile = async (file, data) => {
  const string =
    path.extname(file) == "csv"
      ? d3.csvFormat(data)
      : JSON.stringify(data, null, 2);
  await fs.writeFile(file, string);
};

const parseTransactions = async ({
  path,
  parser,
  account,
  categories,
  filter = () => true,
  transform = (d) => d,
}) => {
  const paths = (await stat(path)).isDirectory()
    ? (await readdir(path))
      .filter((file) => !file.startsWith("."))
      .map((file) => join(path, file))
    : [path];
  const results = await Promise.all(paths.map((path) => parser(path)));
  const transactions = results.flat();
  const addCategory = (d) => {
    for (let c of categories.filter((c) => "filter" in c)) {
      if (c.filter({ ...d, text: d.payee_name + " | " + (d.notes || "") }))
        return { ...d, category: c.name };
    }
    return d;
  };
  const uniqueTransactions = unique(transactions, [
    "date",
    "amount",
    "payee_name",
    "notes",
  ])
    .filter(filter)
    .map((d) => addCategory(transform({ ...d, account })));
  console.log(
    `Would import ${uniqueTransactions.length} transactions for ${account}`,
  );
  console.table(uniqueTransactions, [
    "date",
    "payee_name",
    "amount",
    "category",
    "transfer",
  ]);
  return uniqueTransactions;
};

const setupBudget = async ({ categories, accounts }) => {
  await actualAPI.deleteCategories();
  console.log("Categories deleted");
  await actualAPI.setupCategories(categories);
  console.log("Categories set up");
  await actualAPI.deleteAccounts();
  console.log("Accounts deleted");
  await actualAPI.setupAccounts(accounts);
  console.log("Accounts set up");
};

const importTransactions = async ({
  accounts,
  categories,
  argv,
  configPath,
}) => {
  const mFilter = monthFilter({ month: argv.month });

  const promises = accounts.map((account) => {
    if ((argv.account && account.name !== argv.account) || !account.folder) {
      return Promise.resolve([]);
    }
    if (!(account.parser in parsers)) {
      console.error(`Parser ${account.parser} not found`);
      return Promise.resolve([]);
    }
    return parseTransactions({
      path: path.join(path.dirname(configPath), account.folder),
      parser: parsers[account.parser],
      account: account.name,
      categories,
      filter:
        "filter" in account ? (d) => mFilter(d) && account.filter(d) : mFilter,
      transform: "transform" in account ? account.transform : (d) => d,
    });
  });
  const allTransactions = await Promise.all(promises);
  var filename = argv.file
    ? argv.file
    : await input({
      type: "text",
      name: "filename",
      message: "Write to 'actual' or [file.json/csv]?",
    });
  if (filename === "actual")
    await actualAPI.importTransactions(
      Object.fromEntries(
        accounts.map((account, i) => [account.name, allTransactions[i]]),
      ),
    );
  else
    writeToFile(
      path.join(path.dirname(configPath), filename),
      allTransactions.flat(),
    );
};

const categorize = async ({ argv, configPath, categories }) => {
  const actualCategories = actualAPI.getCategories({ by: "name" });

  if (!argv.file) {
    console.log(
      `Specify a file to import categories from a file. Trying categorization using the rules from the config file`,
    );
    const transactions = actualAPI
      .getTransactions()
      .filter((t) => !t.transfer_id && !t.is_parent);
    const addCategory = (d) => {
      for (let c of categories.filter((c) => "filter" in c)) {
        if (c.filter({ ...d, text: d.payee_name + " | " + (d.notes || "") }))
          return { ...d, category: c.name, oldCategory: d.category };
      }
      return { ...d, oldCategory: d.category };
    };
    const categorized = transactions
      .map(addCategory)
      .filter((t) => t.category !== t.oldCategory);
    console.log(`Categorized ${categorized.length} transactions`);
    console.table(categorized, [
      "date",
      "payee_name",
      "category",
      "oldCategory",
    ]);
    const answer = await confirm({ message: "Continue?" });
    if (answer) {
      await actualAPI.updateTransactions(
        Object.fromEntries(
          categorized.map((t) => [
            t.id,
            { category: actualCategories[t.category].id },
          ]),
        ),
      );
      console.log("Transactions imported");
    }
    return;
  }

  const makeStr = (t) => `${t.date} | ${t.payee_name} | ${t.notes}`;
  var fileTransactions = (await readFromFile(argv.file)).filter(
    (t) => t.category !== null,
  );
  const fileTransactionsMap = Object.fromEntries(
    fileTransactions.map((t) => [makeStr(t), t.category]),
  );

  const transactions = actualAPI.getTransactions();
  const missing = transactions.filter(
    (t) => !t.category && !t.transfer_id && !t.is_parent,
  );

  const found = missing
    .filter((t) => makeStr(t) in fileTransactionsMap)
    .map((t) => ({ ...t, category: fileTransactionsMap[makeStr(t)] }));
  const foundWithKnown = found.filter((t) => t.category in actualCategories);

  console.log(
    `Found ${found.length} transactions in file, out of which ${foundWithKnown.length} have known actual categories`,
  );
  console.table(found, ["date", "payee_name", "category"]);
  const answer = await confirm({ message: "Continue?" });
  if (answer) {
    await actualAPI.updateTransactions(
      Object.fromEntries(
        foundWithKnown.map((t) => [
          t.id,
          { category: actualCategories[t.category].id },
        ]),
      ),
    );
    console.log("Transactions imported");
  }
};

const exportTransactions = async ({ argv, configPath }) => {
  const transactions = actualAPI.getTransactions();
  const fileName = await input({
    type: "text",
    name: "filename",
    message: "File to write to [csv/json]",
    default: path.basename(configPath).split(".")[0] + ".json",
  });
  writeToFile(fileName, transactions);
};

const main = async () => {
  const argv = yargs(hideBin(process.argv))
    .option("config", {
      describe: "The configuration file to use",
      type: "string",
      alias: "c",
      demandOption: true,
      global: true,
    })
    .command("setup", "Run the setup")
    .command("delete", "Delete all transactions")
    .command("categorize [file]", "Categorize missing transactions")
    .command("export [file]", "Export transactions")
    .command("import [file]", "Import a file", (yargs) => {
      yargs
        .positional("file", {
          description: "Import to 'actual' or write to [file.json/csv]",
          alias: "f",
          type: "string",
        })
        .option("month", {
          description:
            "Month to import, e.g. 2021-01 for a specific month, or 2021-01,2021-02 for a range. Ranges are inclusive and can be open-ended with a comma at the start or end.",
          alias: "m",
          type: "string",
        })
        .option("account", {
          description: "Account to import",
          alias: "a",
          type: "string",
        });
    })
    .help()
    .alias("help", "h")
    .demandCommand(1, "").argv;

  if (argv._.length === 0) {
    yargs.showHelp();
  }

  if (!argv.config || !argv.config.endsWith(".mjs")) {
    console.error("Invalid config file");
    return;
  }

  console.log(`Using config file ./${argv.config}`);

  const configPath = path.join(process.cwd(), argv.config);
  const { categories, accounts, sync_id } = await import(configPath);

  await actualAPI.init(sync_id);

  if (argv._[0] === "setup") {
    await setupBudget({
      categories,
      accounts,
      argv,
    });
  } else if (argv._[0] === "import") {
    await importTransactions({ accounts, categories, argv, configPath });
  } else if (argv._[0] === "delete") {
    await actualAPI.deleteTransactions();
  } else if (argv._[0] === "categorize") {
    await categorize({ argv, configPath, categories });
  } else if (argv._[0] === "export") {
    await exportTransactions({ argv, configPath });
  } else {
    console.error("Invalid command");
  }

  await actualAPI.shutdown();
};

main();
