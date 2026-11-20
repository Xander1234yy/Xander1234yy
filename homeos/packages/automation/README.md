# @homeos/automation — fase 5

Eigen rules engine (triggers → voorwaarden → acties) die lokaal in de Device Connector draait.

Ontwerpafspraken die nu al gelden:
- Opdrachten van de engine hebben bron `automation` en gaan door `checkCommand()` uit `@homeos/shared`.
- De **noodstop** blokkeert alle opdrachten met bron `automation` (al afgedwongen in de connector).
- Veiligheidskritische apparaattypen (`SAFETY_CRITICAL_KINDS`) worden nooit automatisch bediend.
- Bij een offline connector worden opdrachten niet in een wachtrij gezet en na herstart niet alsnog uitgevoerd.
