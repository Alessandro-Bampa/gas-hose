# Hose

<img src="icons/icon-192.png" alt="" width="96" align="right">

**Italiano** · [English](README.en.md)

Applicazione per gestire il risparmio mensile con la regola **50/30/20**:
le entrate di ogni mese vengono divise in tre budget, **Necessità** (50%),
**Svago** (30%) e **Risparmi** (20%). Le percentuali si possono cambiare.

È un sito statico (solo HTML, CSS e JavaScript, nessuna libreria esterna né server).
I dati restano **sul tuo dispositivo**: in file **Excel** (uno per anno) in una cartella
scelta da te, oppure nel browser.

## Come si usa

### Online e installabile

Apri **https://alessandro-bampa.github.io/gas-hose/** e, se vuoi, installala come app:

- **Chrome / Edge su computer:** icona «Installa» nella barra dell'indirizzo.
- **Android (Chrome):** menu ⋮ › *Installa app*. Se compare solo *Aggiungi a schermata Home*,
  toccalo e scegli *Installa* (non «Crea scorciatoia»).
- **iPhone / iPad (Safari):** pulsante Condividi › *Aggiungi alla schermata Home*.

Una volta aperta, l'app funziona anche **senza connessione**.

### Dal computer, senza internet

Fai doppio clic su `index.html` e aprilo con Chrome o Edge. In questo modo non è installabile,
ma tutto il resto funziona allo stesso modo.

## Dove vanno i dati

Al primo avvio scegli dove salvarli.

**In una cartella** (Chrome/Edge su computer, Chrome su Android). Un file Excel per anno,
aggiornato in automatico. Il browser chiede il permesso di modificare i file: sul computer
scegli **«Consenti a ogni visita»**; su Android può chiedere di riconfermarlo a ogni apertura
(«Riconnetti»).

- **Computer:** puoi scegliere una cartella dentro OneDrive, Google Drive per desktop o iCloud
  per Windows, così i file finiscono anche nel cloud.
- **Android:** scegli una cartella come `Documenti/Hose` (evita `Android/data`, che il sistema
  può svuotare). Per avere gli stessi file anche sul computer, sincronizza quella cartella con il
  cloud tramite un'app di sincronizzazione.
- Se cancelli i dati di Chrome o disinstalli l'app, i file nella cartella **restano**: basta
  riaprire Hose e scegliere di nuovo la stessa cartella.

**Solo in questo browser** (iPhone/iPad, Firefox, Safari). I dati restano nella memoria del
browser o dell'app installata. Con *Impostazioni › Esporta* scarichi gli Excel o un backup
completo `.zip` (su iPhone puoi salvarlo in File › iCloud Drive); con *Importa* lo ripristini
o lo sposti su un altro dispositivo.

> **Attenzione:** in questa modalità, *Cancella spazio di archiviazione* di Chrome (o «Cookie e
> dati dei siti») cancella anche i dati di Hose; svuotare solo la cache non li tocca. Fai ogni
> tanto un **Backup completo**.

**Più dispositivi sugli stessi file.** Hose legge i file all'apertura. Se modifichi da un
dispositivo, chiudi e riapri l'app sull'altro prima di inserire nuovi dati, altrimenti il
salvataggio successivo sovrascrive le modifiche fatte altrove.

## Cosa c'è nella cartella dati

```
dati/
  Hose_2025.xlsx          ← un file per anno
  Hose_2026.xlsx
  impostazioni.json       ← percentuali predefinite, categorie, obiettivi, regole dell'import
  import/
    2026-08.json          ← movimenti della banca già importati o scartati, un file per mese
```

I file vengono aggiornati in automatico a ogni modifica (in alto a destra vedi «Salvato alle …»).
**Non tenere aperto il file Excel mentre usi l'app**: Excel lo blocca e il salvataggio non riesce
(l'app te lo segnala e puoi premere «Riprova» dopo averlo chiuso).

### Struttura del file Excel

- **Riepilogo**: totali di ogni mese (entrate, budget, speso, saldo per suddivisione), totale
  dell'anno e **avanzi e risparmi**: valore iniziale, delta dell'anno, valore finale, più
  usato dall'avanzo, prelievi dai fondi e soldi messi da parte per obiettivi.
- **Gennaio … Dicembre**: l'elenco dei movimenti (Tipo = Entrata / Uscita / Dall'avanzo /
  Prelievo, Data, Suddivisione, Categoria, Descrizione, Importo, Ricorrente, Obiettivo) e, a
  destra, il riepilogo del mese: budget, speso, saldo, avanzo (o risparmi) dei mesi precedenti,
  variazione del mese, valore a fine mese, prelievi, messi da parte per obiettivi.

I riepiloghi usano formule Excel vere (`SOMMA.PIÙ.SE`, riferimenti tra fogli), quindi il file
resta leggibile e coerente anche aperto da solo. I dati però vanno inseriti dall'app.

## Come funzionano i conti

**Necessità e Svago**

- **Budget** = entrate del mese × percentuale.
- **Saldo del mese** = budget − uscite pagate con il budget del mese. Può andare in negativo.
- **Avanzo dei mesi precedenti** = quanto ti è avanzato (o, se negativo, quanto hai sforato)
  in *tutti i mesi precedenti*. Il mese in corso non è incluso. Non si azzera a fine anno.
- Se sfori il budget l'app ti dice se lo sforamento è **coperto dall'avanzo** (arancione)
  oppure **scoperto** (rosso).
- **Avanzo totale a fine mese** = avanzo dei mesi precedenti + saldo del mese − quanto usato
  dall'avanzo. Passa al mese successivo.

**Risparmi**

- Il **budget** è quanto dovresti accantonare nel mese: la scheda mostra quanto manca, oppure
  «Obiettivo di risparmio del mese raggiunto».
- I **risparmi accumulati** crescono con gli accantonamenti e calano con i **prelievi**: un
  prelievo è una spesa fatta con i risparmi (es. la lavatrice rotta pagata col *Fondo di
  emergenza*). Nel Riepilogo la linea dei Risparmi sale quando accantoni e scende quando prelevi.
- Un prelievo non toglie nulla all'obiettivo di risparmio del mese: se hai accantonato la tua
  quota, il mese resta in regola. Anche un importo negativo inserito nei Risparmi diventa un prelievo.

**Obiettivi esclusi.** I soldi messi da parte per gli obiettivi **non** sono compresi né negli
avanzi né nei risparmi accumulati: hanno un fondo a parte, mostrato separatamente.

Il **delta dell'anno** è di quanto sono cambiati avanzi e risparmi. È salvato nel foglio
«Riepilogo» insieme ai valori di inizio anno: se un giorno manca il file dell'anno precedente, i
conti restano corretti.

### Tipi di uscita

| Tipo | Quando usarlo | Effetto |
|---|---|---|
| **Spesa** / **Accantonamento** | il caso normale | usa il budget del mese |
| **Dall'avanzo** (Necessità, Svago) | vuoi usare quanto avanzato nei mesi precedenti | non pesa sul budget del mese, riduce l'avanzo |
| **Prelievo** (Risparmi) | paghi con soldi già accantonati | non pesa sul budget del mese, riduce i risparmi accumulati |

Nella scheda Risparmi trovi **«Dove sono i risparmi»** con il saldo di ogni fondo. Nel Riepilogo
c'è la tabella **«Fondi accantonati»**.

## Obiettivi

Indichi nome, importo e mese in cui ti servono i soldi, e scegli da quale budget accantonare:

- **Svago** per qualcosa che vuoi: *Viaggio in Giappone, 3.000 €, maggio 2028*.
- **Risparmi** per una spesa futura prevista: *Caldaia nuova, 2.500 €, tra 3 anni*.

L'app propone la **rata mensile** che serve per arrivare alla scadenza; puoi cambiarla e vedi
subito quando il fondo sarà pronto.

**La rata è fissa.** Non si ricalcola da sola se un mese accantoni di più o di meno. Nella scheda
dell'obiettivo l'app ti dice com'è il piano:

- **In anticipo** (hai messo da parte più del previsto): proposte **«Riduci la rata»** (stessa
  scadenza) oppure **«Anticipa la scadenza»** (stessa rata). Oppure lasci tutto com'è.
- **Indietro**: proposte **«Aumenta la rata»** oppure **«Sposta la scadenza»**.
- **In linea**: con la rata attuale arrivi alla scadenza.

Ogni obiettivo ha un **fondo tutto suo**, separato dalle categorie. Conta solo quello che
destini a lui: le rate (pulsante «Accantona», oppure scegliendo «🎯 nome obiettivo» al posto della
categoria). Una spesa normale, anche nella stessa categoria (es. un weekend fuori in «Vacanze»),
**non** si somma all'obiettivo del viaggio lungo.

- **Partire con una somma:** quando crei o modifichi un obiettivo puoi coprirne subito una parte,
  con l'avanzo dei mesi precedenti (Svago) o spostando soldi da un fondo dei risparmi già
  accumulati (Risparmi). La rata si abbassa di conseguenza.
- **Soldi vincolati:** i prelievi normali non possono toccare il fondo di un obiettivo. Per le
  spese **dell'obiettivo** usa **«Usa il fondo»** nella sua scheda (es. i biglietti del volo, le
  spese durante il viaggio): la scheda mostra quanto hai messo da parte, quanto hai già usato e
  quanto resta.
- **Svincolare:** se ti servono soldi del fondo per **altre spese**, usa **«Svincola»**. Per lo
  Svago la somma torna nell'avanzo di Svago; per i Risparmi torna nei risparmi liberi, nel fondo
  che scegli. Il messo da parte cala, quindi scegli subito se **ricalcolare la rata** (stessa
  scadenza), **mantenere la rata** spostando la data, oppure decidere dopo.
- **Eliminare un obiettivo:** per lo Svago, i soldi messi da parte tornano nell'avanzo di Svago.
  Per i Risparmi, tornano nei risparmi accumulati come fondo libero con il nome dell'obiettivo.

Nella pagina del mese, le schede Svago e Risparmi mostrano le rate da versare, con un pulsante
per aggiungerle al volo.

## Importare i movimenti dalla banca

Invece di inserire le spese a mano puoi caricare l'elenco movimenti scaricato dalla banca:
pulsante **«Importa movimenti»** nella pagina del mese, oppure *Impostazioni › Dati e file*.

| Banca | File |
|---|---|
| **ING** | `.xlsx` oppure `.csv` (stessi movimenti: puoi usare l'uno o l'altro) |
| **BPER** | `.xls`, così come lo scarichi |

La banca e il formato si riconoscono dal contenuto del file, quindi non devi sceglierli. Puoi
caricare più file insieme (es. ING e BPER).

**Come vengono smistati.** Ogni movimento va nel mese della sua data (la data valuta: per i
pagamenti con carta è il giorno dell'acquisto) e riceve una destinazione:

- **Necessità** o **Svago**, con categoria, per le uscite. Un accredito su carta (es. un reso) è un
  **rimborso** e riduce le spese della categoria.
- **Entrata** per lo stipendio e gli altri accrediti.
- **Prelievo dai Risparmi**, proposto per le uscite di **500 €** o più (es. caparra, polizza): se
  le hai pagate con i soldi messi da parte, così non pesano sul budget del mese.
- **Escludi** per i giroconti tra i tuoi conti (anche tra ING e BPER), le operazioni annullate
  dalla banca (storni) e i movimenti già presenti nel mese (stesso importo, data vicina).

L'import non crea mai accantonamenti nei Risparmi. Per decidere usa, in quest'ordine: i casi
speciali qui sopra, le **regole imparate** dalle tue correzioni e un elenco di esercenti noti
(supermercati, carburante, pedaggi, telefono, ristoranti, abbonamenti…).

**Prima di salvare** vedi un riepilogo per destinazione e per mese, e scegli:

- **Importa così**: usa le proposte. I movimenti dubbi vanno in Svago › Altro (o come proposto).
- **Rivedi i movimenti**: l'elenco con i **dubbi in cima, in giallo con ⚠**. Per ogni movimento
  cambi la destinazione e la categoria. Toccandolo vedi il dettaglio: descrizione, testo originale
  della banca, «Ricorda per i prossimi import». Se cambi un esercente, gli altri movimenti dello
  stesso esercente si aggiornano.

Dopo l'import un messaggio permette di **annullarlo**.

**Impara dalle correzioni.** Quando correggi un movimento, Hose ricorda la scelta per
quell'esercente (es. «CONESTOGA NO LOUNGE → Svago › Cene fuori») e la usa nei prossimi import. Le
regole si vedono e si eliminano in *Impostazioni › Import dalla banca*.

**Niente doppioni.** I movimenti già importati o scartati non vengono riproposti se reimporti lo
stesso periodo (anche passando dal `.csv` all'`.xlsx` di ING). Hose li registra nella cartella
`import/`, un file per mese della data contabile (`import/2026-08.json`), con un movimento per riga:
cosa ne è stato (importato e dove, oppure scartato e perché). A ogni import legge solo i mesi
toccati; se un mese non ha ancora il file, i suoi movimenti sono tutti nuovi. Nel browser lo
stesso elenco sta nella memoria del browser. Il backup `.zip` lo comprende.

Ogni movimento è identificato da banca, data contabile, importo e un codice ricavato dal testo
della banca (es. `ING|2026-08-04|-8.20|1x2y3z`): così due spese uguali nello stesso giorno restano
distinte. Gli intestatari e gli IBAN dei tuoi conti, letti dagli elenchi movimenti e salvati nelle
impostazioni, servono a riconoscere i giroconti tra i tuoi conti anche quando la causale non dice
«giroconto».

Se nel mese avevi inserito le spese a mano come totali (es. «Spesa alimentare 250 €»), il
riepilogo te lo segnala: eliminale dopo l'import per non contarle due volte.

## Altre funzioni

- **Voci ricorrenti**: segna come ricorrenti stipendio, affitto, abbonamenti… Quando apri un mese
  vuoto l'app propone di copiarle dal mese precedente.
- **Suddivisione per mese**: «Modifica %» cambia le percentuali solo per quel mese. I mesi già
  registrati conservano la loro.
- **Categorie**: aggiungile e rimuovile da *Impostazioni*, oppure creane una mentre inserisci una
  spesa. Rimuovere una categoria non cancella le voci già registrate.
- **Importa / Esporta** (*Impostazioni › Dati e file*): Excel di un anno, CSV dei movimenti,
  backup completo `.zip` (tutti gli anni + impostazioni), importabile su un altro dispositivo.
  «Importa» accetta anche gli elenchi movimenti della banca.
- **Frecce ← →** della tastiera per passare da un mese all'altro.
- Tema chiaro/scuro e layout adatto anche al telefono.

## Struttura del progetto

```
index.html
manifest.webmanifest   descrizione dell'app installabile (nome, icone, colori)
sw.js                  service worker: funzionamento offline
icons/                 icone dell'app
css/style.css
js/xlsx-lite.js        lettura/scrittura dei file .xlsx (senza librerie esterne)
js/xls-lite.js         lettura dei vecchi file .xls (BIFF8), per gli elenchi movimenti BPER
js/model.js            calcoli 50/30/20, avanzi, risparmi, obiettivi, formato del file Excel
js/bank-import.js      import dei movimenti della banca: lettura, riconoscimento, smistamento
js/store.js            salvataggio su cartella o nel browser
js/charts.js           grafici
js/app.js              interfaccia
dati/                  i tuoi dati: esclusi da Git (.gitignore), non vanno mai pubblicati
```

## Pubblicazione su GitHub Pages

1. Carica il progetto nel repository (la cartella `dati/` è esclusa dal `.gitignore`).
2. Su GitHub: *Settings › Pages › Build and deployment* › «Deploy from a branch»,
   ramo `main`, cartella `/ (root)`.
3. Dopo circa un minuto il sito è online all'indirizzo indicato sopra.

Dopo un aggiornamento, l'app installata scarica la nuova versione alla prima apertura con
connessione. Se cambi l'elenco dei file dell'app, aumenta la versione in `sw.js`
(`const CACHE = 'hose-v2'`).
