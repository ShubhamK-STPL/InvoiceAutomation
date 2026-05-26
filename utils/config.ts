export const appConfig = {
  voucher: process.env.DEFAULT_VOUCHER || 'Sales Invoice',
  saleLedger: new RegExp(process.env.DEFAULT_SALE_LEDGER || 'Fodder Sales'),
  runStatus: process.env.RUN_STATUS || '', // '' = process all, 'skipped' = process only skipped, 'success' = process only success
  clearSession: process.env.CLEAR_SESSION === 'true',
};
