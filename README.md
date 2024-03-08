# Actual Budget CLI

CLI to interact with the [Actual Budget](https://actualbudget.org) API.

## Installation

```bash
npm install -g actual-budget-cli
```

## Usage

```bash
$ actual-budget-cli --help
actual-budget-cli <command>

Commands:
  actual-budget-cli setup              Run the setup
  actual-budget-cli delete             Delete all transactions
  actual-budget-cli categorize [file]  Categorize missing transactions
  actual-budget-cli export [file]      Export transactions
  actual-budget-cli import [file]      Import a file

Options:
      --version  Show version number                                   [boolean]
  -c, --config   The configuration file to use               [string] [required]
  -h, --help     Show help                                             [boolean]
```

## Configuration

**.env** file in the current working directory or in the user's home directory.

```bash
SERVER_URL=https://your.url
SERVER_PASSWORD=acutal-budget-password
NODE_TLS_REJECT_UNAUTHORIZED=0 # Only if you are using a self-signed certificate
```

**config.js** file for the account / category settings

```javascript
export const sync_id = "your-sync-id";

// only required for setup/categorize
export const categories = [
  {
    name: "Groceries",
    group: "Food",
    filter: ({ payee_name, account, notes, amount }) =>
      /(COOP|Coop|Migros)/.test(text),
  },
  { name: "Salary", group: "Income" },
  { name: "Starting Balance", group: "Income" },
];

export const accounts = [
  {
    name: "Credit Suisse Current",
    type: "checking",
    initial_balance: 0,
    folder: "Credit Suisse Current",
    parser: "Credit Suisse",
  },
  {
    name: "Credit Suisse Credit",
    type: "credit",
    initial_balance: 0,
    folder: "Credit Suisse Credit",
    parser: "Credit Suisse Credit",
  },
];
```

## Supplied Parsers

- Credit Suisse
- Credit Suisse Credit / Swisscard
- Cembra Money Bank (PDF parser)
- DKB
- ZKB
- Interactive Brokers

### Custom Parsers

A parser is just a function taking a file path and returning an array of transactions

```javascript
const parser = async (file) => {
  const data = await ... // read the file
  // parse the data

  return [
    {
      date: "2020-01-01",
      payee_name: "Test",
      amount: -100,
      notes: "Test",
      category: "Groceries",
    },
  ];
};

```
