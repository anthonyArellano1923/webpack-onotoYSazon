import ProductsCards from '../components/ProductsCards.js'

const Menu = async function () {
  const cards = await ProductsCards()
  const view = `
      <section id="menu" class="menu">
      <div class="menu__blanck-space"></div>
      <div class="menu__title">
        <div class="menu__lateral-line">
          <div class="menu__lateral-line--box1"></div>
          <div class="menu__lateral-line--box2"></div>
        </div>
        <h1 class="menu__heading">Menú</h1>
        <div class="menu__lateral-line">
          <div class="menu__lateral-line--box1"></div>
          <div class="menu__lateral-line--box2"></div>
        </div>
      </div>
      <div class="menu__subtext">
        <p>Una opción para cada necesidad.</p>
      </div>
      <section class="menu__cards">
        ${cards}
      </section>
      <div class="menu__blanck-space"></div>
    </section>`
  return view
}

export default Menu 