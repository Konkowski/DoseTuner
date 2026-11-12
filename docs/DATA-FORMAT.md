# Data format

DoseTuner reads a **CSV with one row per bottle**, exported from your PLC / HMI / data logger. Separator (`,` `;` tab) and decimal mark (`.` `,`) are detected automatically. Column names are matched by aliases (see `FIELDS` in `src/core.js`); you can fix the mapping on screen.

| Field | Required | Meaning | Example header names |
|---|---|---|---|
| head | yes | Dosing head number | `head`, `nozzle`, `valve`, `station` |
| closing point | yes | Closing threshold applied, **% of setpoint** (e.g. 98.5) | `close_at_pct`, `closing_point`, `cutoff_pct` |
| flow | yes | Product flow during the fill | `flow`, `flow_ml_s`, `massflow` |
| density | yes | Product density | `density`, `rho` |
| net weight | yes | Checkweigher net weight | `net_weight_g`, `weight`, `peso` |
| target | yes | Target weight | `target`, `target_g`, `nominal` |
| temperature | no | Product temperature | `temp`, `temp_C` |
| pressure | no | Tank pressure | `pressure`, `pressure_bar` |
| T1, T2 | no | Tolerance limits (g, ±) | `T1_g`, `T2_g` |
| time | no | Timestamp | `time`, `timestamp` |
| dose time | only for ms files | Commanded dose time | `dose_time_ms` |

## Units
- **Percent files (recommended):** closing point is a % of the setpoint. Detected automatically.
- **Millisecond files (legacy):** closing point is an anticipation in ms and a dose-time column is required. Supported, but the app then speaks in ms.
- You can override the detection in the unit selector.

## Tips
- The PLC should log, **per bottle**, the value that was actually applied (not only the recipe).
- Align each checkweigher weight to the head that filled it (the PLC tracks bottles; DoseTuner does not manage delays or machine states).
- Use only production data. Exclude start-up, cleaning and stopped periods in the PLC export.
- ≥ 200 bottles per head recommended; the app reports when data is insufficient.

Examples: [`examples/example_plc_history_pct.csv`](../examples/example_plc_history_pct.csv) and [`examples/example_plc_history_ms.csv`](../examples/example_plc_history_ms.csv) (simulated).
