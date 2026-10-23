# Hose

<img src="icons/icon-192.png" alt="" width="96" align="right">

[Italiano](README.md) · **English**

An app to manage your monthly savings with the **50/30/20 rule**: each month's income is split
into three budgets, **Necessità** (needs, 50%), **Svago** (leisure, 30%) and **Risparmi**
(savings, 20%). The percentages can be changed.

It is a static website (plain HTML, CSS and JavaScript, no external libraries and no server).
Your data stays **on your device**: in **Excel** files (one per year) inside a folder you
choose, or in the browser.

> The app's interface is in Italian. Below, Italian labels are shown as they appear in the app,
> with an English translation in brackets.

## How to use it

### Online and installable

Open **https://alessandro-bampa.github.io/gas-hose/** and, if you like, install it as an app:

- **Chrome / Edge on a computer:** "Install" icon in the address bar.
- **Android (Chrome):** ⋮ menu › *Install app*. If you only see *Add to Home screen*, tap it and
  choose *Install* (not "Create shortcut").
- **iPhone / iPad (Safari):** Share button › *Add to Home Screen*.

Once opened, the app also works **offline**.

### On a computer, without internet

Double-click `index.html` and open it with Chrome or Edge. This way it can't be installed, but
everything else works the same.

## Where your data goes

On first launch you choose where to store it.

**In a folder** (Chrome/Edge on a computer, Chrome on Android). One Excel file per year, updated
automatically. The browser asks for permission to edit the files: on a computer choose
**"Allow on every visit"**; on Android it may ask you to confirm again each time you open the app
(«Riconnetti», reconnect).

- **Computer:** you can pick a folder inside OneDrive, Google Drive for desktop or iCloud for
  Windows, so the files are also backed up to the cloud.
- **Android:** pick a folder such as `Documents/Hose` (avoid `Android/data`, which the system may
  wipe). To have the same files on your computer too, sync that folder with the cloud using a
  folder-sync app.
- If you clear Chrome's data or uninstall the app, the files in the folder **stay there**: just
  reopen Hose and choose the same folder again.

**Only in this browser** (iPhone/iPad, Firefox, Safari). Data is kept in the storage of the
browser or of the installed app. With *Impostazioni › Esporta* (Settings › Export) you can
download the Excel files or a full `.zip` backup (on iPhone you can save it to Files › iCloud
Drive); with *Importa* (Import) you can restore it or move it to another device.

> **Warning:** in this mode, Chrome's *Clear storage* (or "Cookies and site data") also deletes
> Hose's data; clearing only the cache does not. Make a **full backup** from time to time.

**Several devices on the same files.** Hose reads the files when it opens. If you make changes on
one device, close and reopen the app on the other one before entering new data; otherwise its
next save will overwrite the changes made elsewhere.

## What's in the data folder

```
dati/
  Hose_2025.xlsx          ← one file per year
  Hose_2026.xlsx
  impostazioni.json       ← default percentages, categories, goals, import rules
```

Files are updated automatically on every change (top right you'll see «Salvato alle …», saved at
…). **Don't keep the Excel file open while using the app**: Excel locks it and saving fails (the
app tells you, and you can press «Riprova», retry, after closing it).

### Excel file layout

- **Riepilogo** (summary): monthly totals (income, budget, spent, balance per budget), yearly
  total and **leftovers and savings**: starting value, year delta, final value, plus amounts used
  from leftovers, withdrawals from funds and money set aside for goals.
- **Gennaio … Dicembre** (January … December): the list of transactions (Tipo/type = Entrata
  income / Uscita expense / Dall'avanzo from leftovers / Prelievo withdrawal, date, budget,
  category, description, amount, recurring, goal) and, on the right, the month's summary: budget,
  spent, balance, leftovers (or savings) from previous months, change in the month, end-of-month
  value, withdrawals, set aside for goals.

The summaries use real Excel formulas (`SUMIFS`, cross-sheet references), so the file stays
readable and consistent even when opened on its own. Data, however, should be entered from the app.

## How the numbers work

**Necessità (needs) and Svago (leisure)**

- **Budget** = month's income × percentage.
- **Saldo del mese** (month balance) = budget − expenses paid from the month's budget. It can go
  negative.
- **Avanzo dei mesi precedenti** (leftovers from previous months) = how much you had left over
  (or, if negative, overspent) in *all previous months*. The current month is not included. It
  doesn't reset at the end of the year.
- If you exceed the budget, the app tells you whether the overspend is **covered by leftovers**
  (orange) or **not covered** (red).
- **Avanzo totale a fine mese** (total leftovers at month end) = leftovers from previous months +
  month balance − amount used from leftovers. It carries over to the next month.

**Risparmi (savings)**

- The **budget** is how much you should set aside this month: the card shows how much is
  missing, or «Obiettivo di risparmio del mese raggiunto» (monthly savings target reached).
- **Accumulated savings** grow with what you set aside and go down with **withdrawals**: a
  withdrawal is an expense paid with your savings (e.g. a broken washing machine paid from the
  *Fondo di emergenza*, emergency fund). In the summary, the savings line goes up when you save
  and down when you withdraw.
- A withdrawal doesn't affect the month's savings target: if you set aside your share, the month
  is still on track. A negative amount entered in Risparmi is also recorded as a withdrawal.

**Goals are kept apart.** Money set aside for goals is **not** included in leftovers or in
accumulated savings: each goal has its own fund, shown separately.

The **year delta** is how much leftovers and savings changed during the year. It is stored in
the «Riepilogo» sheet together with the start-of-year values, so the numbers stay correct even if
the previous year's file is missing.

### Expense types

| Type | When to use it | Effect |
|---|---|---|
| **Spesa** / **Accantonamento** (expense / saving) | the usual case | uses the month's budget |
| **Dall'avanzo** (from leftovers; Necessità, Svago) | you want to use what was left over in previous months | doesn't weigh on the month's budget, reduces leftovers |
| **Prelievo** (withdrawal; Risparmi) | you pay with money already set aside | doesn't weigh on the month's budget, reduces accumulated savings |

In the Risparmi card you'll find **«Dove sono i risparmi»** (where your savings are) with the
balance of each fund. The summary page has a **«Fondi accantonati»** (saved funds) table.

## Goals

Enter a name, an amount and the month you need the money by, and choose which budget to save from:

- **Svago** (leisure) for something you want: *Trip to Japan, €3,000, May 2028*.
- **Risparmi** (savings) for a planned future expense: *New boiler, €2,500, in 3 years*.

The app suggests the **monthly instalment** needed to reach the deadline; you can change it and
immediately see when the fund will be ready.

**The instalment is fixed.** It isn't recalculated automatically if you save more or less in a
given month. On the goal's card the app tells you how your plan is going:

- **Ahead** (you saved more than planned): it suggests **«Riduci la rata»** (lower the
  instalment, same deadline) or **«Anticipa la scadenza»** (bring the deadline forward, same
  instalment). Or you can leave everything as it is.
- **Behind**: it suggests **«Aumenta la rata»** (raise the instalment) or **«Sposta la
  scadenza»** (move the deadline).
- **On track**: with the current instalment you'll reach the deadline.

Each goal has **its own fund**, separate from categories. Only what you assign to it counts:
instalments (the «Accantona» button, or choosing «🎯 goal name» instead of a category). A regular
expense, even in the same category (e.g. a weekend away under «Vacanze», holidays), is **not**
added to the long trip's goal.

- **Start with a lump sum:** when you create or edit a goal you can cover part of it right away,
  with leftovers from previous months (Svago) or by moving money from a fund of your accumulated
  savings (Risparmi). The instalment goes down accordingly.
- **Ring-fenced money:** regular withdrawals can't touch a goal's fund. For expenses **related to
  the goal**, use **«Usa il fondo»** (use the fund) on its card (e.g. flight tickets, expenses
  during the trip): the card shows how much you set aside, how much you've already used and how
  much is left.
- **Releasing money:** if you need some of the fund for **other expenses**, use **«Svincola»**
  (release). For Svago the amount goes back to Svago's leftovers; for Risparmi it goes back to
  your free savings, into the fund you choose. The amount set aside goes down, so you choose right
  away whether to **recalculate the instalment** (same deadline), **keep the instalment** and move
  the date, or decide later.
- **Deleting a goal:** for Svago, the money set aside goes back to Svago's leftovers. For
  Risparmi, it goes back to accumulated savings as a free fund named after the goal.

On the month page, the Svago and Risparmi cards show the instalments due, with a button to add
them in one tap.

## Importing transactions from the bank

Instead of entering expenses by hand you can load the transaction list downloaded from your bank:
the **«Importa movimenti»** (import transactions) button on the month page, or *Impostazioni ›
Dati e file*.

| Bank | File |
|---|---|
| **ING** | `.xlsx` or `.csv` (same transactions: either one works) |
| **BPER** | `.xls`, as downloaded |

The bank and the format are recognised from the file's content, so you don't pick them. You can
load several files at once (e.g. ING and BPER).

**How transactions are sorted.** Each transaction goes to the month of its date (the value date:
for card payments it is the day of the purchase) and gets a destination:

- **Necessità** or **Svago**, with a category, for expenses. A credit on the card (e.g. a return)
  is a **refund** and reduces the category's spending.
- **Entrata** (income) for salary and other credits.
- **Prelievo dai Risparmi** (withdrawal from savings), suggested for expenses of **€500** or more
  (e.g. a deposit, an insurance policy): if you paid them with money set aside, they don't weigh
  on the month's budget.
- **Escludi** (exclude) for transfers between your own accounts (ING and BPER included),
  operations cancelled by the bank (reversals) and transactions already in the month (same amount,
  close date).

The import never creates savings contributions. To decide it uses, in this order: the special
cases above, **rules learned** from your corrections, and a list of known merchants (supermarkets,
fuel, tolls, phone, restaurants, subscriptions…).

**Before saving** you see a summary by destination and by month, and choose:

- **Importa così** (import as is): uses the suggestions. Uncertain transactions go to Svago › Altro
  (or as suggested).
- **Rivedi i movimenti** (review): the list with the **uncertain ones at the top, in yellow with
  ⚠**. For each transaction you change destination and category. Tap it to see the details:
  description, the bank's original text, «Ricorda per i prossimi import» (remember for next
  imports). Changing a merchant updates the other transactions from the same merchant.

After the import a message lets you **undo** it.

**Learns from corrections.** When you correct a transaction, Hose remembers the choice for that
merchant (e.g. «CONESTOGA NO LOUNGE → Svago › Cene fuori») and uses it in the next imports. Rules
are listed, and can be deleted, in *Impostazioni › Import dalla banca*.

**No duplicates.** Transactions already imported or discarded are not offered again if you
re-import the same period (even switching between ING's `.csv` and `.xlsx`). If you had entered
the month's expenses by hand as totals (e.g. «Spesa alimentare 250 €»), the summary points it out:
delete them after the import so they aren't counted twice.

## Other features

- **Recurring items**: mark salary, rent, subscriptions… as recurring. When you open an empty
  month, the app offers to copy them from the previous month.
- **Per-month split**: «Modifica %» (edit %) changes the percentages for that month only. Months
  already recorded keep their own.
- **Categories**: add and remove them in *Impostazioni* (settings), or create one while entering
  an expense. Removing a category doesn't delete the items already recorded.
- **Import / Export** (*Impostazioni › Dati e file*, settings › data and files): Excel for one
  year, CSV of transactions, full `.zip` backup (all years + settings), which can be imported on
  another device. «Importa» also accepts the bank's transaction lists.
- **← → arrow keys** to move between months.
- Light/dark theme and a layout that also works on phones.

## Project structure

```
index.html
manifest.webmanifest   installable app description (name, icons, colours)
sw.js                  service worker: offline support
icons/                 app icons
css/style.css
js/xlsx-lite.js        reads/writes .xlsx files (no external libraries)
js/xls-lite.js         reads old .xls files (BIFF8), for BPER transaction lists
js/model.js            50/30/20 maths, leftovers, savings, goals, Excel file format
js/bank-import.js      bank transaction import: reading, recognition, sorting
js/store.js            storage in a folder or in the browser
js/charts.js           charts
js/app.js              user interface
dati/                  your data: excluded from Git (.gitignore), never publish it
```

## Publishing on GitHub Pages

1. Push the project to the repository (the `dati/` folder is excluded by `.gitignore`).
2. On GitHub: *Settings › Pages › Build and deployment* › "Deploy from a branch", branch `main`,
   folder `/ (root)`.
3. After about a minute the site is live at the address above.

After an update, the installed app downloads the new version the first time it's opened with a
connection. If you change the list of app files, bump the version in `sw.js`
(`const CACHE = 'hose-v2'`).
