import * as ExcelJS from 'exceljs';
import * as path from 'path';

export type InvoiceInput = {
  unitName: string;
  partyName: string;
  invoiceDate: string;
  discountPercent: string;
  discountAmount: string;
  totalAmount: string;
  quantity: string;
  rate: string;
  salePrice: string;
  companyLedgerId: string;
  voucherTypeId: string;
  materialName: string;
  insertStatus: string;
  status: string;
};

export class ExcelManager {
  private filePath: string;
  private workbook: ExcelJS.Workbook;
  private worksheet!: ExcelJS.Worksheet;

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'DataDriven', 'invoice-input.xlsx');
    this.workbook = new ExcelJS.Workbook();
  }

  async loadInvoiceInputs(): Promise<{ invoice: InvoiceInput; rowIndex: number }[]> {
    try {
      await this.workbook.xlsx.readFile(this.filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new Error(`Excel file not found at ${this.filePath}. Make sure you convert your CSV to invoice-input.xlsx!`);
      }
      throw err;
    }

    this.worksheet = this.workbook.worksheets[0]; // Assume first sheet

    const inputs: { invoice: InvoiceInput; rowIndex: number }[] = [];
    
    // We assume row 1 contains headers
    const headers: string[] = [];
    this.worksheet.getRow(1).eachCell((cell, colNumber) => {
      headers[colNumber] = cell.text.trim();
    });

    // Start reading from row 2
    this.worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const rowData: any = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (header) {
          rowData[header] = cell.text.trim();
        }
      });

      // Map to InvoiceInput format
      const invoice: InvoiceInput = {
        unitName: rowData['unitName'] ?? '',
        partyName: (rowData['partyName'] ?? '').replace(/"/g, ''),
        invoiceDate: rowData['invoiceDate'] ?? '',
        discountPercent: rowData['discountPercent'] ?? '',
        discountAmount: rowData['discountAmount'] ?? '',
        totalAmount: rowData['totalAmount'] ?? '',
        quantity: rowData['quantity'] ?? '',
        rate: rowData['rate'] ?? '',
        salePrice: rowData['salePrice'] ?? '',
        companyLedgerId: rowData['companyLedgerId'] ?? '',
        voucherTypeId: rowData['voucherTypeId'] ?? '',
        materialName: rowData['materialName'] ?? '',
        insertStatus: rowData['insertStatus'] ?? '',
        status: rowData['status'] ?? '',
      };

      // Ensure we don't process completely empty rows
      if (invoice.unitName || invoice.partyName || invoice.materialName) {
        inputs.push({ invoice, rowIndex: rowNumber });
      }
    });

    return inputs;
  }

  async updateExcelColumn(rowIndex: number, columnName: string, value: string) {
    // Reload workbook in case it was modified externally
    await this.workbook.xlsx.readFile(this.filePath);
    this.worksheet = this.workbook.worksheets[0];

    const headerRow = this.worksheet.getRow(1);
    let targetColNumber = -1;

    headerRow.eachCell((cell, colNumber) => {
      if (cell.text.trim() === columnName) {
        targetColNumber = colNumber;
      }
    });

    // If column doesn't exist, append it
    if (targetColNumber === -1) {
      targetColNumber = this.worksheet.columnCount + 1;
      headerRow.getCell(targetColNumber).value = columnName;
      headerRow.commit();
    }

    const row = this.worksheet.getRow(rowIndex);
    row.getCell(targetColNumber).value = value;
    row.commit();

    const maxRetries = 10;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.workbook.xlsx.writeFile(this.filePath);
        break;
      } catch (error: any) {
        if (error.code === 'EBUSY') {
          console.warn(`\n[WARNING] The Excel file is locked (likely open). Please close it! Retrying in 3 seconds... (Attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          console.error('Failed to update Excel:', error);
          break;
        }
      }
    }
  }
}
