// The preview does not bundle the Excel readers; LinkedIn import runs in the real app.
const unavailable = () => {
  throw new Error("LinkedIn file import is available in the installed app, not in this browser preview.");
};
const ExcelStub = { Workbook: class { constructor() { unavailable(); } } };
export default ExcelStub;
export const read = unavailable;
export const utils = { sheet_to_json: unavailable };
