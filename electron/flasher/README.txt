TOFFEE FACTORY FLASHER
Firmware: Normal 940 mA (profile 13)

1. Extract the entire ZIP. Keep the application and its companion files together.
   Open Toffee Factory Flasher.exe on a 64-bit Windows PC.
2. Use the station's known-good USB port. Connect only one Module PCB.
3. For a new board, put it in BOOTSEL (RP2 Boot) before connecting it.
   Confirm that only the intended PCB is connected and click Flash firmware.
4. If RP2 Boot does not connect, open Windows USB driver setup, click
   Install Windows USB driver, and approve the administrator prompt.
   Use the same port and keep only the intended board connected.
5. Keep USB connected until you see Board programmed. Firmware readback and
   startup verified. Once the firmware is flashed, the PCB will continuously
   cycle through a rainbow LED animation. Confirm the animation on each new
   PCB, then disconnect it and select Flash another board.

For an already programmed Module, use Update a programmed board. The flasher
backs up its VIA settings, verifies the installed firmware, and restores the
settings. An update retains the board's saved lighting preferences. If
interrupted, reconnect the same PCB on the same USB port and use
Recover an update. Update details also contains a download of the bundled UF2.

The firmware and driver helper are included. No internet connection or Node.js
installation is needed. This pilot build is unsigned. Have the factory verify
one board at its station before starting a production batch.
