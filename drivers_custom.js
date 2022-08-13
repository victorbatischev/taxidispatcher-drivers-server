var config = {
  user: 'driver_server',
  password: 'driver_server',
  server: 'localhost\\SQLEXPRESS', // You can use 'localhost\\instance' to connect to named instance
  database: 'TD5R1',

  options: {
    encrypt: false // Use this if you're on Windows Azure
  }
}

module.exports.config = config
