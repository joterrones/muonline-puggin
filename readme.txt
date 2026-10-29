PjsVivos — panel web de jugadores online (PeruMU)

Instalar:
  npm install

Arrancar:
  npm start

Si el puerto 3000 está ocupado:
  set PORT=3010 && npm start

Abrir:
  http://localhost:3000
  (o el puerto que indiques)

Funciones:
  - Agregar / quitar guilds a seguir (se guardan en guilds.json)
  - Activar/desactivar guilds y filtrar cuáles se muestran online
  - Ranking completo del server, paginado de 20 en 20
  - Filtro del ranking por nombre de PJ

La primera carga del ranking puede tardar (~30s) porque descarga todos los registros.
