const Net = require('net')
const Modbus = require('jsmodbus')
const Reconnect = require('node-net-reconnect')

var Homebridge, Service, Characteristic, UUIDGen, Log;
module.exports = function (api) {
  Homebridge = api;
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  UUIDGen = api.hap.uuid;
  Homebridge.registerPlatform("homebridge-modbus", "Modbus", ModbusPlatform);
};

class ModbusPlatform {

  constructor(log, config, homebridge) {
    Log = log;
    Log("Modbus plugin for HomeBridge");
    Log("Copyright © 2020 by Stephane Clavel, released under LGPLv3 License");
    if (!config) return;
    this.config = config;

    let sockOptions = {
      'host': config.ip || '127.0.0.1',
      'port': config.port || 502,
      'retryTime': 1000,
      'retryAlways': true
    };

    this.socket = new Net.Socket();
    this.reconnect = new Reconnect(this.socket, sockOptions);
    this.modbus = new Modbus.client.TCP(this.socket, 1);

    homebridge.on("didFinishLaunching", () => {
      Log("Finished launching");
      this.socket.connect(sockOptions);
    });

    this.socket.on('connect', () => {
      Log("Socket connected");
      if (this.interval) {
        clearInterval(this.interval);
      }
      else {
        this.update();
      }
      this.interval = setInterval(this.update.bind(this), config.pollFrequency || 1000);
    });

    this.socket.on('error', (error) => {
      Log(error);
    });

  }

  accessories(callback) {
    if (!this.config)
      return;
    this.status = [];
    this.charList = [];
    this.minModbus = [];
    this.maxModbus = [];

    let accessoriesMap = new Map;
    this.config["accessories"].forEach((config) => {
      let accessory = accessoriesMap.get(config.name);
      if (!accessory) {
        accessory = new ModbusAccessory(config.name, this);
        accessoriesMap.set(config.name, accessory);
      }
      accessory.configs.push(config);
    });

    callback(Array.from(accessoriesMap.values()));
  }

  update(type='c') {
    if (type!='X') {
      let nextType = {'c':'r', 'r':'i', 'i':'X'}[type];
      if (!this.maxModbus[type]) {
        this.update(nextType);
        return;
      }
      let idx = this.minModbus[type];
      let count = 1+this.maxModbus[type]-idx;
      this.modbus[{'c':'readCoils', 'r':'readHoldingRegisters', 'i':'readInputRegisters'}[type]](idx-1, count).then((resp) => {
        this.status[type] = resp.response._body.valuesAsArray;
        this.update(nextType);
      }).catch(() => {
        Log("error reading modbus", type, idx, count);
        this.socket.end(); // force to trigger a reconnection
      });
    }
    else {
      this.charList.forEach((obj) => {
        let idx = this.minModbus[obj.type];
        let val = this.status[obj.type][obj.add - idx];
        obj.accessory.update(obj.characteristic, val, obj.map);
      });
    }
  }

  writeModbus(type, add, val, map) {
    this.modbus[{'c':'WriteSingleCoil', 'r':'writeSingleRegister'}[type]](add-1, Math.round(val));
  }

}

class ModbusAccessory {

  constructor(name, platform) {
    this.name = name;
    this.platform = platform;
    this.uuid_base = UUIDGen.generate(name);
    this.configs = [];
    this.lastUpdate = Date.now();
  }

  getServices() {

    let services = [];
    let service = new Service.AccessoryInformation();
    service
        .setCharacteristic(Characteristic.Manufacturer, "Modbus")
        .setCharacteristic(Characteristic.Model, this.name)
        .setCharacteristic(Characteristic.SerialNumber, this.uuid_base);
    services.push(service);

    this.configs.forEach((config) => {

      if (!Service[config.type]) {
        Log("unknown service", config.type);
        return;
      }

      let service = null;
      if (config.subtype) {
        service = new Service[config.type](config.subtype, config.subtype);
      }
      else {
        service = new Service[config.type]();
      }
      services.push(service);

      for (let charType in config) {
        if (charType=='name' || charType=='type' || charType=='subtype') {
          continue;
        }
        if (charType[0]<'A' || charType[0]>'Z') {
          Log("unknown config element (remember characteristics are case sensitive)", charType);
          continue;
        }
        if (!Characteristic[charType]) {
          Log("unknown characteristic", charType);
          continue;
        }
        let characteristic = service.getCharacteristic(Characteristic[charType]);
        if (!characteristic) {
          Log("service", config.type, "doesn't have characteristic", charType)
        }

        let cfg = config[charType];
        let modbusType, modbusAdd, modbusMap;
        if (typeof cfg == 'string') {
          modbusType = cfg[0];
          modbusAdd = parseInt(cfg.substr(1));
          modbusMap = {};
        }
        else if (typeof cfg == 'number') {
          modbusType = 'r';
          modbusAdd = cfg;
          modbusMap = {};
        }
        else {
          if (address in cfg) {
            modbusType = cfg.address[0];
            modbusAdd = parseInt(cfg.address.substr(1));
          }
          modbusMap = cfg;
        }

        if (validValues in modbusMap) {
          characteristic.props.validValues = modbusMap.validValues;
        }
        if (maxValue in modbusMap) {
          characteristic.props.maxValue = modbusMap.maxValue;
        }
        if (value in modbusMap) {
          characteristic.setValue(modbusMap.value);
          if (!address in cfg)
            continue;
        }

        if (!modbusAdd || !['c','r','i'].includes(modbusType)) {
          Log("invalid modbus address", cfg);
          continue;
        }
        if (!this.platform.minModbus[modbusType] || this.platform.minModbus[modbusType] > modbusAdd) {
          this.platform.minModbus[modbusType] = modbusAdd;
        }
        if (!this.platform.maxModbus[modbusType] || this.platform.maxModbus[modbusType] < modbusAdd) {
          this.platform.maxModbus[modbusType] = modbusAdd;
        }

        if (modbusType == 'i') {
          modbusMap.readonly = true;
        }
        if (!modbusMap.readonly) {
          characteristic.on('set', (val, callback) => {
            Log("setting", characteristic.displayName, "to", val);
            this.lastUpdate = Date.now();
            if (modbusMap.map) {
              for (v1 in modbusMap.map) {
                if (modbusMap.map[v1] == val) {
                  val = v1;
                  break;
                }
              }
            }
            if (modbusMap.mask) {
              val = val & modbusMap.mask;
            }
            this.platform.writeModbus(modbusType, modbusAdd, val);
            callback();
          });
        }

        this.platform.charList.push({'accessory': this, 'characteristic': characteristic, 'type': modbusType, 'add': modbusAdd, 'map': modbusMap});
      }
    });

    return services;
  }

  identify(callback) {
    Log(this.configs);
    callback();
  }

  update(characteristic, val, map) {
    if (Date.now() < this.lastUpdate + 1000) {
      return;
    }
    if (map.mask) {
      val = val & map.mask;
    }
    if (map.map && toString(val) in map.map) {
      val = map.map[toString(val)];
    }
    if (val != characteristic.value) {
      characteristic.setValue(val);
      Log(this.name, characteristic.displayName, val);
    }
  }

}