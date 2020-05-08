const Net = require('net')
const Modbus = require('jsmodbus')

var Homebridge, Service, Characteristic, UUIDGen, Log, logFile;
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

    this.ip = {
      'host': config.ip || '127.0.0.1',
      'port': config.port || 502
    }
    this.socket = new Net.Socket();
    this.modbus = new Modbus.client.TCP(this.socket, config.unit || 1);
    this.commands = [];

    // modbus 模式 0:批量采集模式 1：单个采集模式 
    if (!('modbus_mode' in config)) {
      this.modbus_mode = 0;
    } else {
      this.modbus_mode = config.modbus_mode;
    }
    

    homebridge.on("didFinishLaunching", () => {
      this.socket.connect(this.ip);
      Log("Connecting to", this.ip.host);
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

    this.socket.on('close', (error) => {
      if (error) {
        Log(error);
      }
      Log("Connection lost");
      setTimeout(() => {
        this.socket.connect(this.ip);
        Log("Reconnecting to", this.ip.host);
      }, 5000);
    });

    this.socket.on('modbus', this.onQueue.bind(this));

  }

  accessories(callback) {
    if (!this.config){
      return;
    }

    this.status = [];
    this.charList = [];
    this.minModbus = [];
    this.maxModbus = [];
    this.firstInit = true;

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

  update() {

    if (this.command) {
      if (Date.now() > this.commandTime + 10000) {
        Log("ERROR: command queue got stuck !");
        this.reset();
        return;
      }
      Log("warning: polling faster than modbus can reply");
      return;
    }


    if (this.modbus_mode == 0){
      for (let type in this.maxModbus) {
        let idx = this.minModbus[type];
        let count = this.maxModbus[type]-idx+1;
        this.commands.push({"cmd":'r', "type":type, "add":idx, "count":count});
      }
    }else{
      for(var i=0; i<this.charList.length; i++){
        let obj = this.charList[i];
        let type = obj.type;
        let idx = obj.add;
        let count = obj.map.len;
        this.commands.push({"cmd":'r', "type":type, "add":idx, "count":count});
      }
    }

    this.commands.push({"cmd":'x'});

    this.socket.emit('modbus');

  }

  writeModbus(type, add, val, map) {
    this.commands.push({"cmd":'w', "type":type, "add":add, "val":val});
    if (!this.command && this.commands.length == 1) {
      this.socket.emit('modbus');
    }
  }

  onQueue() {
    if (this.command || !this.commands.length) return;

    this.command = this.commands.shift();
    this.commandTime = Date.now();

    if (this.command.cmd == 'w') {
      this.modbus[{'c':'WriteSingleCoil', 'r':'writeSingleRegister'}[this.command.type]](this.command.add, Math.round(this.command.val));
      this.command = null;
      if (this.commands.length)
        this.socket.emit('modbus');
    }

    else if (this.command.cmd == 'r') {
      this.modbus[{'c':'readCoils', 'r':'readHoldingRegisters', 'i':'readInputRegisters'}[this.command.type]](this.command.add, this.command.count).then((resp) => {
        if(this.modbus_mode==0){
          this.status[this.command.type] = resp.response._body.valuesAsArray;
        }else{
          let k = this.command.type.toString()+"_"+this.command.add.toString();
          this.status[k] = resp.response._body.valuesAsArray;
        }
       
        this.command = null;
        if (this.commands.length)
          this.socket.emit('modbus');
      }).catch((error) => {
        Log("error reading modbus", this.command, error);
        this.reset();
      });
    }

    else if (this.command.cmd == 'x') {
      this.charList.forEach((obj) => {
        let val = [];
        if(this.modbus_mode==0){
          let idx = this.minModbus[obj.type];
          for (let i = 0; i < obj.map.len; i++) {
            val.push(this.status[obj.type][obj.add - idx+i]);
          }
        }else{
          let k = obj.type.toString()+"_"+obj.add.toString();
          val = this.status[k];
        }

        obj.accessory.update(obj.characteristic, val, obj.map);
      });
      this.firstInit = false;
      this.command = null;
      if (this.commands.length)
        this.socket.emit('modbus');
    }

  }

  reset() {
    if (this.interval) {
      clearInterval(this.interval);
    }
    this.commands = [];
    this.command = null;
    this.socket.end();    
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
          if ('address' in cfg) {
            modbusType = cfg.address[0];
            modbusAdd = parseInt(cfg.address.substr(1));
          }
          modbusMap = cfg;
        }
        //  寄存器长度
        if (!('len' in modbusMap)) {
          modbusMap.len = 1;
        }

        if ('validValues' in modbusMap) {
          characteristic.props.validValues = modbusMap.validValues;
        }
        if ('maxValue' in modbusMap) {
          characteristic.props.maxValue = modbusMap.maxValue;
        }
        if ('value' in modbusMap) {
          characteristic.setValue(modbusMap.value);
          if (!('address' in cfg))
            continue;
        }

        if (!modbusAdd || !['c','r','i'].includes(modbusType)) {
          Log("invalid modbus address", cfg);
          continue;
        }
        if (!this.platform.minModbus[modbusType] || this.platform.minModbus[modbusType] > modbusAdd) {
          this.platform.minModbus[modbusType] = modbusAdd;
        }
        if (!this.platform.maxModbus[modbusType] || this.platform.maxModbus[modbusType] < modbusAdd+modbusMap.len) {
          this.platform.maxModbus[modbusType] = modbusAdd+modbusMap.len;
        }

        
        if (modbusType == 'i') {
          modbusMap.readonly = true;
        }
        if (!modbusMap.readonly) {
          characteristic.on('set', (val, callback) => {
            Log("setting", this.name, characteristic.displayName, "to", val);
            this.lastUpdate = Date.now();
            if (characteristic.props.format == 'bool') {
              val = val ? 1 : 0;
            }
            if ('map' in modbusMap) {
              for (let v1 in modbusMap.map) {
                if (modbusMap.map[v1] == val) {
                  val = parseInt(v1);
                  break;
                }
              }
            }
            if ('mask' in modbusMap) {
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
    if (Date.now() < this.lastUpdate + 1000 && !this.platform.firstInit) {
      return;
    }


    if (characteristic.props.format == 'bool') {
      val = val ? true : false;
    }else if(characteristic.props.format == 'float'){
      if(val.length == 2){
        let v1 = val[0]&0xFF;
        let v2 = (val[0]>>8)&0xFF;
        let v3 = val[1]&0xFF;
        let v4 = (val[1]>>8)&0xFF;
        let buffer = Buffer.from([v1,v2,v3,v4]);
        val = buffer.readFloatLE(0)
      }else{
        return;
      }
     
    }else if(characteristic.props.format == 'uint32'){
      if(val.length == 2){
        let v1 = val[0]&0xFF;
        let v2 = (val[0]>>8)&0xFF;
        let v3 = val[1]&0xFF;
        let v4 = (val[1]>>8)&0xFF;
        let buffer = Buffer.from([v1,v2,v3,v4]);
        val = buffer.readUInt32LE(0)
      }
     
    }else{
      // 其它类型
    }

    if ('mask' in map) {
      val = val & map.mask;
    }
    if ('map' in map && (val.toString() in map.map)) {
      val = map.map[val.toString()];
    }

    

    if (val != characteristic.value) {
      Log(this.name, characteristic.displayName, characteristic.value, "=>", val);
      characteristic.updateValue(val);
      if (map.log) {
        if (!logFile)
          logFile = require('fs').createWriteStream("logfile.csv", {flags:'a'});
        if (logFile)
          logFile.write(new Date().toISOString()+','+this.name+','+val+"\n");
      }
    }
  }

}