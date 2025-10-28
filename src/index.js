import Main from './templates/Main.js'
import Header from './templates/Header.js'
import Footer from './templates/footer.js'
import './css/style.css'
import './css/tablet.css'
import './css/desktop.css'

async function App() {
  const app = document.getElementById('app')
  const header = document.createElement('header')
  const main = document.createElement('main')
  const footer = document.createElement('footer')

  const headerContent = Header()
  const mainContent = await Main()
  const footerContent = Footer()

  header.innerHTML = headerContent
  main.innerHTML = mainContent
  footer.innerHTML = footerContent

  app.append(
    header,
    main,
    footer
  )
}

window.addEventListener('load', App)