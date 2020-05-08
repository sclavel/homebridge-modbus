# homebridge-modbus

Hombridge plugin for controlling appliances through ModbusTCP

You must define each accessory in the config.json file, with a `name`, a `type` (that matches any HomeKit Service type), and one or more characteristics (that match HomeKit Characteristics for this Service).
If you want to group several services under the same accessory, just reuse the same accessory name, and add a `subtype` field if services are of the same type.
The characteristics value in the json is the modbus address associated with it.
Coils are defined with the letter 'c' followed by the coil number, holding registers are defined with the letter 'r' followed by the register number, input registers are defined with the letter 'i' followed by the register number.

If you want more advanced control, the characteristic value can instead be an object having `address` as the coil/register type and number, and optional elements like `validValues`, `maxValue`, `value` to configure HomeKit, `mask` and/or `map` to map different values between modbus and homekit, `readOnly` to force holding registers or coils to not be written on modbus (input registers are always read-only).

服务类型：
https://developer.apple.com/documentation/homekit/hmservicetypelightbulb
https://github.com/homebridge/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts

Example config.json:
```json
{
  "platforms": [
    {
      "platform": "Modbus",
      "ip": "20.0.0.11",
      "port": 502,
      "pollFrequency": 10000,
      "modbus_mode": 1,
      "accessories": [
        {
          "name": "Bedroom ventilation",
          "type": "Fan",
          "On": "r1"
        },
        {
          "name": "Bedroom light",
          "type": "Switch",
          "On": "c1"
        },
        {
          "name": "Bedroom",
          "type": "Thermostat",
          "TargetTemperature": "r2",
          "CurrentTemperature": "i1",
          "CurrentHeatingCoolingState": {
            "address": "r3",
            "readonly": true,
            "mask": "2",
            "map": {
              "0": 0,
              "2": 1
            },
            "validValues": [
              0,
              1
            ]
          },
          "TargetHeatingCoolingState": {
            "value": 1,
            "validValues": [
              1
            ]
          }
        },
        {
          "name": "Water Heater",
          "type": "TemperatureSensor",
          "subtype": "from boiler",
          "CurrentTemperature": {
            "address": "r1",
            "len": 2
          }
        },
        {
          "name": "Water Heater",
          "type": "TemperatureSensor",
          "subtype": "to boiler",
          "CurrentTemperature": {
            "address": "i1",
            "len": 2
          }
        },
        {
          "platform": "Modbus",
          "ip": "20.0.0.251",
          "port": 502,
          "modbus_mode": 1,
          "pollFrequency": 3000,
          "accessories": [
            {
              "name": "湿度",
              "type": "HumiditySensor",
              "CurrentRelativeHumidity": {
                "address": "r160",
                "len": 2
              }
            },
            {
              "name": "温度",
              "type": "TemperatureSensor",
              "CurrentTemperature": {
                "address": "r158",
                "len": 2
              }
            },
            {
              "name": "研发北灯带",
              "type": "Lightbulb",
              "On": "r81"
            },
            {
              "name": "研发北人感",
              "type": "MotionSensor",
              "MotionDetected": {
                "address": "r29",
                "map": {
                  "0": 0,
                  "1": 1,
                  "2": 0
                }
              }
            }
          ]
        },
        {
          "platform": "Modbus",
          "ip": "20.0.0.208",
          "port": 502,
          "modbus_mode": 1,
          "pollFrequency": 3000,
          "accessories": [
            {
              "name": "光照度",
              "type": "LightSensor",
              "CurrentAmbientLightLevel": {
                "address": "r5",
                "len": 1
              }
            }
          ]
        },
         {
            "platform": "Modbus",
            "ip": "20.0.0.11",
            "port": 502,
            "modbus_mode": 1,
            "pollFrequency": 3000,
            "accessories": [
                {
                    "name": "Int测试",
                    "type": "Lightbulb",
                    "On": {
                        "address": "r1",
                        "len": 1
                    },
                    "ColorTemperature": {
                        "address": "r3",
                        "len": 2
                    }
                }
            ]
        },
        {
          "cameras": [
            {
              "name": "公司大门摄像头",
              "videoConfig": {
                "source": "-re -i rtsp://admin:saftop9854@20.0.2.2:554/h264/ch36/sub/av_stream"
              }
            }
          ],
          "platform": "Camera-ffmpeg"
        }
      ]
    }
  ]
}
```