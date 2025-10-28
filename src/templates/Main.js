import Menu from "../templates/Menu.js"
import Contact from "../templates/Contact.js"
import Tradition from "../templates/Tradition.js"

async function Main() {
  const menu = await Menu()
  const contact = await Contact()
  const tradition = Tradition()
  const view = `
    ${menu}
    ${contact}
    ${tradition}
  `
  return view
}

export default Main