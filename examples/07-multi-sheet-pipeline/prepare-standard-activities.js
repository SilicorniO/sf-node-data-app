const { prepareActivity } = require('./activity-transform');

module.exports = function prepareStandardActivity(row, context) {
  return prepareActivity(row, context, false);
};
