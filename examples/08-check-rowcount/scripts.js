module.exports = {
  // >>> action: Enough Employees
  // Passes only when the employees sheet has more than 3 rows.
  'Enough Employees': function (sheets) {
    return sheets['employees'].data.length > 3;
  },
  // <<< action: Enough Employees

  // >>> action: No Placeholder Departments
  // Fails when any row has "XXXX" in the Department column.
  'No Placeholder Departments': function (sheets) {
    const sheet = sheets['employees'];
    const column = sheet.fieldNames.indexOf('Department');
    if (column < 0) return true;
    return sheet.data.every(row => row[column] !== 'XXXX');
  },
  // <<< action: No Placeholder Departments
};
