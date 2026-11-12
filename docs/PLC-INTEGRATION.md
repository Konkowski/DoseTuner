# PLC integration

## Today: CSV (supported)
Export the per-bottle history from the PLC/HMI/logger and load it. This works with any brand and needs no network access to the machine. See [DATA-FORMAT.md](DATA-FORMAT.md).

## Why not OPC UA / EtherNet/IP directly?
Browsers cannot open raw TCP/UDP sockets, so a web app cannot speak `opc.tcp://` or EtherNet/IP. Options:

| Route | Status | Notes |
|---|---|---|
| CSV export | ✅ supported | Simplest, robust |
| MQTT over WebSocket (`wss://`) | 🧭 roadmap | Needs a broker reachable from the phone; read-only live feed |
| OPC UA / EtherNet/IP via a gateway | 🧭 possible | A small gateway on the plant network republishes values as MQTT/HTTP. Keep read-only |

## Principles
- DoseTuner is **read-only** with respect to the machine.
- Proposed values are entered by a person.
- Never expose the PLC network to the internet for this tool.
- Log per bottle the *applied* closing point, flow, density, temperature, pressure and weight, aligned to the head.
