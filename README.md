# PushUp

Aplicación web progresiva (PWA) en español para iPhone. Cuenta los toques como repeticiones, guarda fecha, hora, duración y modo en el historial del navegador, y propone series con progresión gradual según tu nivel y objetivo. El plan aumenta las repeticiones tras cada sesión completa y añade una serie cada dos sesiones, hasta seis, con descansos de 60 segundos entre series. La progresión avanza solo al completar el entrenamiento; se recomiendan 48 horas de recuperación entre sesiones.

## Probar en el ordenador

Desde esta carpeta, inicia un servidor local:

```powershell
python -m http.server 8000
```

Abre `http://localhost:8000` en el navegador. El historial y el plan se guardan en ese navegador; no se sincronizan entre dispositivos.

## Instalar en iPhone

Publica estos archivos en un sitio con HTTPS. En el iPhone, abre su dirección con Safari, toca **Compartir** y elige **Añadir a pantalla de inicio**. Una vez cargada, la app puede abrirse sin conexión.

El botón cuenta un toque manual por repetición; no detecta automáticamente el movimiento ni la nariz. Coloca el teléfono de forma estable y toca la pantalla al bajar. Durante la sesión, el contador emite un tono sutil; en modo libre también lee en voz alta el número de cada repetición. Al descansar, anuncia la pausa y emite pitidos durante los últimos cinco segundos antes de la serie siguiente. El sonido se activa al iniciar una sesión; comprueba el volumen y el modo silencio del iPhone.
