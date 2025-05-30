const chalk = require('chalk');

const log = {
  success: (msg) => console.log(chalk.green(`✅ ${msg}`)),
  info: (msg) => console.log(chalk.blue(`ℹ️ ${msg}`)),
  warn: (msg) => console.log(chalk.yellow(`⚠️ ${msg}`)),
  error: (msg) => console.log(chalk.red(`❌ ${msg}`)),
};

module.exports = log;
