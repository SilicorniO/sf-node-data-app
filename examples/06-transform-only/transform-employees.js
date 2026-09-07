module.exports = function transformEmployee(row) {
  row.FullName = [row.FirstName, row.MiddleName, row.LastName].filter(Boolean).join(' ');
  const salary = Number(row.Salary);
  row.SalaryBand = salary < 70000 ? 'Junior' : salary <= 90000 ? 'Mid' : 'Senior';
  row.Role = row.IsManager === 'true' ? 'Manager' : 'Individual Contributor';
  row.YearsOfService = String(
    Math.floor((Date.now() - new Date(row.HireDate).getTime()) / (1000 * 60 * 60 * 24 * 365))
  );
  row.AnnualBonus = String(Math.round(salary * (row.IsManager === 'true' ? 0.1 : 0.05)));
  return row;
};
