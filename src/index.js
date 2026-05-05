/**
 * @fileoverview Punto de entrada principal de la aplicación OnotoYSazón.
 *
 * Este módulo orquesta el montaje inicial de la página web: importa las
 * plantillas de cada sección (Header, Main, Footer), las inserta en el
 * nodo raíz del DOM y registra el evento de carga para inicializar todo
 * una vez que el navegador haya terminado de parsear la página.
 *
 * @module index
 */

import Main from './templates/Main.js'
import Header from './templates/Header.js'
import Footer from './templates/footer.js'
import './css/style.css'
import './css/tablet.css'
import './css/desktop.css'

/**
 * Inicializa y monta la aplicación en el DOM.
 *
 * Crea los elementos semánticos `<header>`, `<main>` y `<footer>`,
 * les asigna el HTML generado por cada plantilla (Header, Main, Footer)
 * y los adjunta al contenedor raíz `#app` definido en el HTML base.
 *
 * La función es `async` porque `Main` realiza una carga de datos
 * asíncrona (catálogo de productos) antes de generar su HTML.
 *
 * @async
 * @function App
 * @returns {Promise<void>} Promesa que resuelve cuando todos los elementos
 *   han sido insertados en el DOM.
 */
async function App() {
  /** Nodo raíz del documento donde se montará la aplicación. */
  const app = document.getElementById('app')

  /** Elemento semántico para la cabecera del sitio. */
  const header = document.createElement('header')

  /** Elemento semántico para el contenido principal del sitio. */
  const main = document.createElement('main')

  /** Elemento semántico para el pie de página del sitio. */
  const footer = document.createElement('footer')

  /** HTML generado por la plantilla de cabecera (logo y navegación). */
  const headerContent = Header()

  /** HTML generado por la plantilla principal (menú de productos, secciones, etc.). */
  const mainContent = await Main()

  /** HTML generado por la plantilla del pie de página (redes sociales, créditos). */
  const footerContent = Footer()

  header.innerHTML = headerContent
  main.innerHTML = mainContent
  footer.innerHTML = footerContent

  // Inserta las secciones en el contenedor raíz en orden jerárquico.
  app.append(
    header,
    main,
    footer
  )
}

/**
 * Registra `App` como listener del evento `load` del objeto `window`.
 *
 * Esto garantiza que el script se ejecute únicamente después de que
 * el HTML, el CSS y todos los recursos externos hayan terminado de cargarse,
 * evitando errores por intentar manipular elementos del DOM antes de que
 * existan.
 */
window.addEventListener('load', App)