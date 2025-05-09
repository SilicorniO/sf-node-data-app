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

---

Now we are going to create another parameter called "import". It is not required.

In case that we receive the import parameter we are going to execute the SalesforceLoader class.

The SalesforceLoader class is moved to a folder called "loader".

This class load the data contained in the excel file into the Salesforce Org.

The way to do it is defined in the ExecConf read.

It has to read each objectconf of the array objectsConf to import the object. If the object has not name or sfObject variables filled, it is dismissed.

before importing the objects it has to check if we have authentication
