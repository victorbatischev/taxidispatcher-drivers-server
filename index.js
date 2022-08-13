var http = require('http'),
  request = require('request'),
  encoding = require('encoding'),
  express = require('express'),
  app = (module.exports.app = express()),
  session = require('express-session')({
    secret: 'keyboard cat',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 60000 }
  }),
  socketsParams = {},
  custom = require('./config'),
  dbCommon = require('./db')

//sharedsession = require("express-socket.io-session");

//({
//	secret: "my-secret",
//	resave: true,
//	saveUninitialized: true
//})

try {
  app.listen(6033, function () {
    console.log('Express app listening on port 6033!')
  })
} catch (e) {
  console.log(
    'Ошибка запуска сервера, возможно копия уже запущена на данном порту!'
  )
  exit(0)
}

app.use(express.static(__dirname + '/tdclient'))
//app.use(session);
// Use the session middleware
app.use(session)
//app.use(express.cookieDecoder());
//app.use(express.session());

var server = http.createServer(app)
var io = require('socket.io')(server) //pass a http.Server instance
//io.use(sharedsession(session, {
//	autoSave: true
//}));
server.listen(8088)
console.log('Сервер водителей TaxiDispatcher запущен на порту 8088...')

var sql = require('mssql')
var clientsLimit = 50
var clientsCount = 0

var config = custom.config

app.get('/', function (req, res) {
  req.session.message = 'Hello World'
})

function findClientsSocket(roomId, namespace) {
  var res = [],
    ns = io.of(namespace || '/') // the default namespace is "/"

  if (ns) {
    for (var id in ns.connected) {
      if (roomId) {
        var index = ns.connected[id].rooms.indexOf(roomId)
        if (index !== -1) {
          res.push(ns.connected[id])
        }
      } else {
        //console.log('[[' + JSON.stringify(io.sockets) + ']]');
        res.push(ns.connected[id])
      }
    }
  }
  return res
}

function checkSocketClients() {
  var currentDate = '[' + new Date().toUTCString() + '] ',
    clcnt = 0,
    socketId
  console.log(currentDate)
  var resC = findClientsSocket(),
    socketsIds = []
  for (i = 0; i < resC.length; i++) {
    //console.log(Object.keys(resC[i]));
    console.log(resC[i].id)
    clcnt++
    socketsIds.push(resC[i].id)
  }

  for (socketId in socketsParams) {
    if (socketsIds.indexOf(socketId) < 0) {
      socketsParams[socketId] = {}
    }
  }

  clientsCount = clcnt
  return false
}

function hasSocketWithUserId(userId) {
  var hasSocket = false,
    socketId

  for (socketId in socketsParams) {
    if (socketsParams[socketId].userId === userId) {
      hasSocket = true
      break
    }
  }

  return hasSocket
}

setInterval(checkSocketClients, 60000)

function queryRequest(sqlText, callbackSuccess, callbackError, connection) {
  var request = new sql.Request(connection)
  request.query(sqlText, function (err, recordset) {
    if (err) {
      console.log(err.message)
      console.log(err.code)
      callbackError && callbackError(err)
    } else {
      callbackSuccess && callbackSuccess(recordset)
    }
  })
}

//модуль работы с массивом водителей
;(function () {
  var useFordWbroadcast = false, //use_ford_wbroadcast
    hasFordWbroadcast = false, //has_ford_wbroadcast
    loadDriverDataWithWsocket = false, //load_driver_data_with_wsocket
    fordersWbroadcast = '',
    driverSocket //forders_wbroadcast

  var connectionWbroadcast,
    createWBConnection = function () {
      connectonAttempts++
      if (connectonAttempts > 5) {
        return
      }

      connectionWbroadcast = createWBroadcastConnPool(config, function () {
        console.log('Success db-connection of Wbroadcast module!')
        setInterval(checkDriversSockets, 10000)
      })
    },
    connectonAttempts = 0,
    broadcastIsProcessing = false

  createWBConnection()

  function createWBroadcastConnPool(connConfig, callBack) {
    return new sql.ConnectionPool(connConfig, function (err) {
      // ... error checks
      if (err) {
        console.log('Err of create Wbroadcast db pool' + err.message) // Canceled.
        console.log(err.code)
        console.log('Next connection attempt after 60 sec...')
        setTimeout(createWBConnection, 60000)
      } else {
        callBack && callBack()
      }
    })
  }

  function checkDriversSockets() {
    useFordWbroadcast = false
    hasFordWbroadcast = false
    fordersWbroadcast = ''
    loadDriverDataWithWsocket = false

    if (broadcastIsProcessing) {
      console.log('FordWbroadcast in processing! Next check after 10 sec...')
      return
    }

    broadcastIsProcessing = true
    checkSystemSettings(function () {
      if (
        useFordWbroadcast &&
        hasFordWbroadcast &&
        fordersWbroadcast &&
        loadDriverDataWithWsocket
      ) {
        console.log('fordersWbroadcasting: ' + fordersWbroadcast)

        for (socketId in socketsParams) {
          driverSocket = socketsParams[socketId].socketObject
          driverId = socketsParams[socketId].userId
          driverNum = socketsParams[socketId].driverNum
          console.log(
            'useFordWbroadcast userId: ' +
              driverId +
              ', driverNum: ' +
              driverNum
          )
          if (driverSocket && driverId && driverNum) {
            console.log('send to driverNum: ' + driverNum)
            driverSocket.emit(
              'forders_wbroadcast',
              JSON.parse(fordersWbroadcast)
            )
          }
        }

        queryRequest(
          'UPDATE Objekt_vyborki_otchyotnosti SET has_ford_wbroadcast=0, ' +
            "forders_wbroadcast='' WHERE Tip_objekta='for_drivers';",
          function (recordset) {
            broadcastIsProcessing = false
          },
          function (err) {
            console.log('Err of reset has_ford_wbroadcast settings! ' + err)
            broadcastIsProcessing = false
          },
          connectionWbroadcast
        )
      } else {
        broadcastIsProcessing = false
        console.log('useFordWbroadcast is off! Next check after 10 sec...')
      }
    })
  }

  function checkSystemSettings(callBack) {
    queryRequest(
      'SELECT TOP 1 use_ford_wbroadcast, has_ford_wbroadcast, load_driver_data_with_wsocket, ' +
        "forders_wbroadcast FROM Objekt_vyborki_otchyotnosti WHERE Tip_objekta='for_drivers';",
      function (recordset) {
        if (
          recordset &&
          recordset.recordset &&
          recordset.recordset.length &&
          recordset.recordset.length == 1
        ) {
          var settingsList = recordset.recordset
          //console.log(sectorCoordsList);
          settingsList.forEach(function (setting) {
            useFordWbroadcast = setting.use_ford_wbroadcast
            hasFordWbroadcast = setting.has_ford_wbroadcast
            fordersWbroadcast = setting.forders_wbroadcast
            loadDriverDataWithWsocket = setting.load_driver_data_with_wsocket
          })

          callBack && callBack()
        }
      },
      function (err) {
        console.log('Err of check Wbroadcast settings! ' + err)
        console.log('Next attempt after 10 sec...')
        broadcastIsProcessing = false
      },
      connectionWbroadcast
    )
  }
})()

io.sockets.on('connection', function (socket) {
  console.log('New sock id: ' + socket.id)
  socketsParams[socket.id] = {}
  var reqTimeout = 0,
    reqCancelTimeout = 0,
    stReqTimeout = 0,
    authTimeout = 0,
    clientActiveTime = 0,
    socketDBConfig = config,
    user = '',
    password = '',
    webProtectedCode = '',
    userId = -1

  var condition = {
      orders: {
        Zavershyon: 0,
        Arhivnyi: 0,
        Predvariteljnyi: 0
      }
    },
    condDependencies = [
      {
        type: 'dataSelect',
        staticExpression: 'TOP',
        Arhivnyi: 1,
        Zavershyon: 1,
        Predvariteljnyi: 'NONE',
        injectExpression: 'TOP 20'
      },
      {
        type: 'dataSelect',
        staticExpression: 'ORDER',
        Arhivnyi: 1,
        Zavershyon: 1,
        Predvariteljnyi: 'NONE',
        injectExpression: 'ORDER BY BOLD_ID DESC'
      },
      {
        type: 'dataSelect',
        staticExpression: 'ORDER',
        Arhivnyi: 0,
        Zavershyon: 0,
        Predvariteljnyi: 'NONE',
        injectExpression: 'ORDER BY BOLD_ID DESC'
      },
      {
        type: 'dataUpdate',
        staticExpression: 'ORDER_DRNUM',
        Pozyvnoi_ustan: 'INJECT',
        id: 'INJECT',
        otpuskaetsya_dostepcherom: 'INJECT',
        adr_manual_set: 'INJECT',
        injectExpression:
          'EXEC	[dbo].[AssignDriverByNumOnOrder] @order_id = ${options.id}, @driver_num = ${options.Pozyvnoi_ustan}, @user_id = ${options.otpuskaetsya_dostepcherom}, @count = 0'
      } //,
      /*{
				type: 'dataUpdate',
				staticExpression: 'ORDER_BAD_COMMENT',
				order_bad_comment: 'INJECT',
				id: 'INJECT',
				otpuskaetsya_dostepcherom: 'INJECT',
				injectExpression: 'EXEC	[dbo].[AddClientToBlackList] @order_id = ${options.id}, @comment = \'${options.order_bad_comment}\', @user_id = ${options.otpuskaetsya_dostepcherom}, @count = 0'
			}*/
    ],
    entityDependencies = {
      orders: [
        {
          type: 'base',
          list: 'ActiveOrders'
        },
        {
          type: 'relation',
          list: 'Sektor_raboty sr LEFT JOIN Spravochnik sp ON sr.BOLD_ID = sp.BOLD_ID',
          link: 'order_sect'
        },
        {
          type: 'relation',
          list: 'DISTRICTS',
          link: 'order_district'
        }
      ]
    }

  function getDependListData(entityDependenciesList, callBack, dependData) {
    if (entityDependenciesList && entityDependenciesList.length) {
      var request = new sql.Request(connection)
      request.query(
        'select * FROM ' + entityDependenciesList[0].list, //
        function (err, recordset) {
          if (err) {
            console.log(err)
            callBack([])
            return
          }
          dependData[entityDependenciesList[0].link] = recordset.recordset

          if (entityDependenciesList.length > 1) {
            entityDependenciesList.splice(0, 1)
            getDependListData(entityDependenciesList, callBack, dependData)
          } else {
            callBack(dependData)
          }
        }
      )
    }
  }

  function getEntityDependData(entity, callBack) {
    var dependData = {},
      entityDependenciesList =
        entityDependencies[entity] &&
        entityDependencies[entity].filter(function (dependency) {
          return dependency.type === 'relation'
        })

    getDependListData(entityDependenciesList, callBack, dependData)
    //callBack([]);
  }

  function getDependenceInject(options, dependencyType) {
    if (!options) {
      return ''
    }

    var dependencies = condDependencies,
      dependStr = '',
      isInjectedOptions = false,
      i

    console.log('len=' + dependencies.length)
    console.log('options: ')
    console.log(options)

    for (i in options) {
      dependencies = dependencies.filter(function (dependency) {
        return (
          typeof dependency[i] !== 'undefined' &&
          (dependency[i] === options[i] ||
            dependency[i] === 'NONE' ||
            dependency[i] === 'INJECT')
        )
      })

      if (!isInjectedOptions) {
        isInjectedOptions |= dependencies.filter(function (dependency) {
          return (
            typeof dependency[i] !== 'undefined' && dependency[i] === 'INJECT'
          )
        }).length
      }
    }

    isInjectedOptions && console.log('is injected!')

    dependencies.forEach(function (dependency) {
      if (
        !isInjectedOptions ||
        validateDependencyOptions(dependency, options)
      ) {
        dependStr += isInjectedOptions
          ? eval('`' + dependency.injectExpression + '`')
          : dependency.injectExpression
      }
    })

    return dependStr
  }

  function validateDependencyOptions(dependency, options) {
    for (i in dependency) {
      if (
        dependency[i] === 'INJECT' &&
        options &&
        typeof options[i] === 'undefined'
      ) {
        return false
      }
    }
    return true
  }

  function decReqTimeout() {
    if (reqTimeout > 0) reqTimeout--
    if (stReqTimeout > 0) stReqTimeout--
    if (reqCancelTimeout > 0) reqCancelTimeout--
    if (authTimeout > 0) authTimeout--
  }

  setInterval(decReqTimeout, 1000)

  if (clientsCount + 1 > clientsLimit) {
    socket.emit('server overload', { me: -1 })
    try {
      socket.disconnect('server overload')
    } catch (e) {
      console.log('error socket disconnect')
    }
    try {
      socket.close()
    } catch (e) {
      console.log('error socket close')
    }
    return
  } else {
    console.log('client connect, num=' + clientsCount)
    clientsCount++
  }

  var connection = createDBConnPool(socketDBConfig)

  function createDBConnPool(connConfig, callBack) {
    return new sql.ConnectionPool(connConfig, function (err) {
      // ... error checks
      if (err) {
        console.log('Err of create db pool: ' + err.message) // Canceled.
        console.log(err.code)
      } else {
        callBack && callBack()
      }
    })
  }

  function dependencyExpression(optionsArray) {
    var dependOptions = {}

    optionsArray.forEach(function (optionItem) {
      Object.assign(dependOptions, optionItem)
    })

    return getDependenceInject(dependOptions)
  }

  function emitData(entity) {
    if (userId < 0) {
      return
    }

    if (entity.indexOf('rsst') === 0) {
      socket.emit('rsst', {
        userId: userId
      })
    } else if (
      entity.indexOf('orders') === 0 &&
      entity.indexOf('orders_coordinates') !== 0
    ) {
      var baseCallback = function (dependData) {
        var request = new sql.Request(connection),
          whereClause =
            ' where (Zavershyon = ' +
            condition.orders.Zavershyon +
            ') AND (Arhivnyi = ' +
            condition.orders.Arhivnyi +
            ')'
        request.query(
          'select ' +
            dependencyExpression([
              { type: 'dataSelect', staticExpression: 'TOP' },
              condition.orders
            ]) +
            ' * FROM ActiveOrders ' +
            whereClause +
            dependencyExpression([
              { type: 'dataSelect', staticExpression: 'ORDER' },
              condition.orders
            ]),
          function (err, recordset) {
            socket.emit('orders', {
              userId: userId,
              orders: recordset && recordset.recordset,
              depends: dependData
            })
          }
        )
      }
      getEntityDependData('orders', baseCallback)
    } else if (entity.indexOf('sectors') === 0) {
      var whereClause = ' where V_rabote = 1 AND Pozyvnoi > 0'
      queryRequest(
        'SELECT dbo.GetJSONSectorList(' + userId + ') as JSON_DATA',
        function (recordset) {
          if (recordset && recordset.recordset) {
            socket.emit('sectors', JSON.parse(recordset.recordset[0].JSON_DATA))
            console.log('sectors success')
          }
        },
        function (err) {
          console.log('Error of sectors get: ' + err)
        },
        connection
      )
    } else if (entity.indexOf('tarifs_and_options') === 0) {
      queryRequest(
        'SELECT dbo.GetJSONTarifAndOptionsList(' + userId + ') as JSON_DATA',
        function (recordset) {
          if (recordset && recordset.recordset) {
            socket.emit(
              'tarifs_and_options',
              JSON.parse(recordset.recordset[0].JSON_DATA)
            )
            console.log('tarifs_and_options success')
          }
        },
        function (err) {
          console.log('Error of tarifs_and_options get: ' + err)
        },
        connection
      )
    } else if (entity.indexOf('orders_coordinates') === 0) {
      var whereClause =
        " where Zavershyon = 0 AND Arhivnyi = 0 AND (NOT (ISNULL(rclient_lat, '') = '' OR ISNULL(rclient_lon, '') = '') OR NOT (ISNULL(adr_detect_lat, '') = '' OR ISNULL(adr_detect_lon, '') = ''))"
      //console.log('orders_coordinates');
      queryRequest(
        "select BOLD_ID as id, (CASE WHEN (ISNULL(rclient_lat, '') <> '') THEN rclient_lat ELSE adr_detect_lat END) as lat, (CASE WHEN (ISNULL(rclient_lat, '') <> '') THEN rclient_lon ELSE adr_detect_lon END) as lon, Adres_vyzova_vvodim as addr, vypolnyaetsya_voditelem FROM Zakaz" +
          whereClause,
        function (recordset) {
          //console.log(recordset.recordset);
          recordset &&
            recordset.recordset &&
            socket.emit('orders_coordinates', {
              userId: userId,
              orders: recordset && recordset.recordset
            })
        },
        function (err) {
          console.log(err)
        },
        connection
      )
    }
  }

  socket.on('app-state', function (data) {
    //console.log('app-state');
    if (data) {
      //data.orders && console.log('emitData orders');
      //data.drivers && console.log('emitData drivers');
      //data.orders_coordinates && console.log('emitData orders_coordinates');
      data.orders && emitData('orders')
      data.drivers && emitData('drivers')
      data.orders_coordinates && emitData('orders_coordinates')
    }
  })

  socket.on('orders-state', function (data) {
    console.log(data)
    if (typeof data === 'string') {
      tp = tryParseJSON(data)
      console.log('=======')
      console.log(tp)
      if (tp) data = tp
    }

    if (data.aspects && data.aspects.length) {
      var aspects = data.aspects
      data = data.states
      console.log(aspects)

      aspects.forEach(function (aspect) {
        eval(aspect + '(data);')
      })
    }

    condition.orders = data
    emitData('orders')
  })

  socket.on('my other event', function (data) {
    console.log(data)
  })

  function tryParseJSON(jsonString) {
    try {
      var o = JSON.parse(jsonString)

      if (o && typeof o === 'object' && o !== null) {
        return o
      }
    } catch (e) {}

    return false
  }

  function identDBConnectCallback() {
    queryRequest(
      'SELECT TOP 1 web_protected_code, use_driver_socket_server FROM Objekt_vyborki_otchyotnosti ' +
        " WHERE Tip_objekta = 'for_drivers' ",
      function (recordset) {
        if (recordset && recordset.recordset && recordset.recordset.length) {
          queryRequest(
            'SELECT TOP 1 BOLD_ID, Pozyvnoi FROM Voditelj ' +
              " WHERE REMOTE_LOGIN = '" +
              user +
              "' AND REMOTE_PASSWORD = '" +
              password +
              "'",
            function (recordset) {
              if (
                recordset &&
                recordset.recordset &&
                recordset.recordset.length
              ) {
                userId = recordset.recordset[0].BOLD_ID

                //if (hasSocketWithUserId(userId)) {
                //	abortConnection('Данный водитель уже подключен!');
                //	return;
                //}

                socketsParams[socket.id]['userId'] = userId
                socketsParams[socket.id]['socketObject'] = socket
                socketsParams[socket.id]['driverNum'] =
                  recordset.recordset[0].Pozyvnoi

                socket.emit('auth', {
                  userId: userId
                })
                console.log('emit auth')

                emitData('sectors')
                console.log('emit sectors')

                emitData('tarifs_and_options')
                console.log('emit tarifs_and_options')
                //setInterval(checkDriversCoordsUpdated, 10000);
              }
            },
            function (err) {},
            connection
          )
        }
      },
      function (err) {},
      connection
    )

    /*if (authTimeout <= 0) {
			authTimeout = 20;

			var request = new sql.Request(connection);

			request.input('phone', sql.VarChar(255), data.phone);
			request.output('client_id', sql.Int, data.id);
			request.output('req_trust', sql.Int, 0);
			request.output('isagainr', sql.Int, 0);
			request.output('acc_status', sql.Int, 0);
			request.execute('CheckClientRegistration', function (err, recordsets, returnValue) {
				if (err) {
					console.log('Error of CheckClientRegistration:' + err.message);
					console.log('Error code:' + err.code);
				} else {
					var parameters = recordsets.output;
					console.log('CheckClientRegistration result client_id=' + parameters.client_id);
					socket.emit('auth', {
						client_id: parameters.client_id,
						req_trust: parameters.req_trust,
						isagainr: parameters.isagainr,
						acc_status: parameters.acc_status
					});
				}

			});
		} else
			console.log("Too many requests from " + data.phone);*/
  }

  socket.on('ident', function (data) {
    console.log('ident')
    console.log(data)
    console.log('=======')
    console.log(typeof data)
    if (typeof data === 'string') {
      tp = tryParseJSON(data)
      if (tp) data = tp
    }

    user = data.login
    password = data.psw
    identDBConnectCallback()
  })

  function abortConnection(abortMsg) {
    socket.emit('abort_connection', {
      msg: abortMsg
    })
    connection = null
  }

  function requestAndSendStatus(conn, did, direct) {
    //if (stReqTimeout <= 0 || direct) {
    stReqTimeout = 20
    var request = new sql.Request(conn)
    request.input('driver_id', sql.Int, parseInt(did))
    //request.input('adres', sql.VarChar(255), encoding.convert('привет мир','CP1251','UTF-8'));
    request.input('show_phone', sql.Int, 1)
    request.output('res', sql.VarChar(2000), '')
    request.execute(
      'GetJSONDriverStatus',
      function (err, recordsets, returnValue) {
        if (err) {
          console.log('requestAndSendStatus error: ' + err.message) // Canceled.
          console.log(err.code) // ECANCEL //
        } else {
          var parameters = recordsets.output
          socket.emit('rsst', JSON.parse(parameters.res))
          console.log('active_orders success')
        }
      }
    )
    //} else {
    //console.log("Too many requests from " + did);
    //}
  }

  socket.on('status', function (data) {
    requestAndSendStatus(connection, userId, true)
    console.log('Status request: ' + JSON.stringify(data))
  })

  var newOrder = function (data) {
    queryRequest(
      "EXEC	[dbo].[InsertOrderWithParamsRDispatcher] @adres = N'', @enadres = N'',@phone = N'',@disp_id = -1, @status = 0, @color_check = 0, @op_order = 0, @gsm_detect_code = 0,@deny_duplicate = 0, @colored_new = 0, @ab_num = N'', @client_id = -1, @ord_num = 0,@order_id = 0",
      function (recordset) {
        emitData('orders')
      },
      function (err) {},
      connection
    )
  }

  socket.on('order', function (data) {
    if (userId < 0) {
      return
    }

    if (typeof data === 'string') {
      tp = tryParseJSON(data)
      if (tp) data = tp
    }

    var counter = 0,
      setPhrase = '',
      wherePhrase = ' WHERE BOLD_ID = ',
      conditionQuery = dependencyExpression([
        { type: 'dataUpdate', staticExpression: 'ORDER_DRNUM' },
        data
      ])

    if (!conditionQuery) {
      for (i in data) {
        if (counter > 0) {
          setPhrase +=
            (counter == 1 ? ' ' : ', ') +
            i +
            '=' +
            (typeof data[i] === 'string' ? "'" + data[i] + "'" : data[i])
        } else {
          wherePhrase += data[i]
        }
        counter++
      }
      conditionQuery =
        setPhrase.length && 'UPDATE Zakaz SET ' + setPhrase + wherePhrase
    }

    console.log(conditionQuery)
    conditionQuery.length &&
      queryRequest(
        conditionQuery,
        function (recordset) {
          if (recordset && recordset.recordset && recordset.recordset.length) {
          }
          emitData('orders')
        },
        function (err) {
          console.log('Err of: ' + conditionQuery)
          emitData('orders')
        },
        connection
      )
  })

  function emitDriverEarlyOrders(driverId) {
    queryRequest(
      'SELECT dbo.GetJSONDriverEarlyOrders(' + driverId + ') as JSON_DATA',
      function (recordset) {
        if (recordset && recordset.recordset) {
          socket.emit(
            'early_orders',
            JSON.parse(recordset.recordset[0].JSON_DATA)
          )
          console.log('early_orders sucess!')
        }
      },
      function (err) {
        //socket.emit('client_info', {error: err});
        console.log('Error of early_orders get: ' + err)
      },
      connection
    )
  }

  socket.on('rqst', function (data) {
    console.log('Answer to status request... userId=' + userId)
    //emitData('rsst');
    requestAndSendStatus(connection, userId)
    emitDriverEarlyOrders(userId)
  })

  socket.on('active_orders', function (data) {
    console.log('Answer to active orders status request... userId=' + userId)
    //emitData('rsst');
    requestAndSendStatus(connection, userId)
  })

  socket.on('early_orders', function (data) {
    console.log('Answer to early orders status request... userId=' + userId)
    //emitData('rsst');
    emitDriverEarlyOrders(userId)
  })

  socket.on('taxometr_parameters', function (data) {
    var data = JSON.parse(data),
      sql =
        'EXEC	[dbo].[SetOrderTaxometrParameters] @current_sum = ' +
        (data.current_sum || 0) +
        ', @current_dist = ' +
        (data.current_dist || 0) +
        ', @order_id = ' +
        (data.order_id || 0) +
        ', @current_time = ' +
        (data.current_time || 0) +
        ', @lat = ' +
        (data.lat || 0) +
        ', @lon = ' +
        (data.lon || 0)
    //console.log(JSON.stringify(data));
    //console.log(sql);
    queryRequest(
      sql,
      function (recordset) {
        console.log('Success of SetOrderTaxometrParameters')
      },
      function (err) {
        console.log('Error of SetOrderTaxometrParameters: ' + err)
      },
      connection
    )
    /*var request = new sql.Request(connection);

		request.current_sum('phone', sql.VarChar(255), data.phone);
		request.output('client_id', sql.Int, data.id);
		request.output('req_trust', sql.Int, 0);
		request.output('isagainr', sql.Int, 0);
		request.output('acc_status', sql.Int, 0);
		request.execute('CheckClientRegistration', function(err, recordsets, returnValue) {
			if(err)	{
				console.log('Error of CheckClientRegistration:'+err.message);                      // Canceled.
				console.log('Error code:'+err.code);                         // ECANCEL //
			}	else	{
				var parameters = recordsets.output;
				console.log('CheckClientRegistration result client_id='+parameters.client_id);
				socket.emit('auth', { client_id: parameters.client_id,
  						req_trust: parameters.req_trust,
  						isagainr: parameters.isagainr,
  						acc_status: parameters.acc_status,
              client_token: parameters.client_id && parameters.client_id > 0 ? clientToken : ''
						});
			}

		});*/
  })

  socket.on('rate-client', function (data) {
    console.log(data)
    if (typeof data === 'string') {
      tp = tryParseJSON(data)
      if (tp) data = tp
    }

    if (true) {
      var request2 = new sql.Request(connection)
      request2.query(
        'EXEC	[dbo].[RateClient] @rate = ' +
          data.rate +
          ', @client_id = ' +
          data.id,
        function (err, recordset) {
          if (err) {
            socket.emit('req_rate_client_answer', { status: 'ERROR' })
            console.log('req_rate_client_answer_error')
            console.log(err.message) // Canceled.
            console.log(err.code) // ECANCEL
          } else {
            socket.emit('req_rate_client_answer', { status: 'OK' })
            console.log('req_rate_client_answer_ok')
          }
        }
      )
    } else socket.emit('req_decline', { status: 'many_rate_client_req' })
    //reqCancelTimeout=60;
  })

  socket.on('disconnect', function () {
    socketsParams[socket.id] = {}
    console.log('user disconnected')
    clientsCount--
  })
})
