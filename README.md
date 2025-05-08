SFWeb Data Loader

Cargar objetos
Cada objeto referenciando otro que se acaba de crear con ese nombre

Definir relación de unos objetos con otros:
Horario laboral: OK
Países: OperatingHoursId = ${Horario Laboral -> Id}

Operativa
Carga en orden
Se carga fichero con bulk api
Se espera
Se obtienen los resultados
Se cargan los Ids y los errores en el CSV
Si ha habido errores se para
Se prepara el siguiente CSV con las transformaciones

Sección de carga de Excel:
Pregunta:

- names in first row?
  Para cada pestaña coge su nombre y crea un CSV

Sección de carga de CSVs:

- names in first row?
  Coge el nombre del CSV para asignar un nombre al fichero

Configuración:
Orden de plantillas
Plantilla (csv):

- Nombre
- Columnas:
  - Nombre
  - Api name
  - Conversión

SFNode Data Manage
Aplicación node:

- 1. Admite excel [OK]
- 2. Lee configuración
- 3. Comprueba que configuración cuadra
- 4. Hace transformaciones antes de cargar cada uno
- 5. Empieza a cargar en orden
- 6. Crea un excel con columnas con los ids o los errores y las transformaciones

RUN:

npm start input/example.xlsx --includeFieldNames > output/result.txt
