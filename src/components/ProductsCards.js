import getData from '../utils/getData.js'

async function ProductsCards() {
  const products = await getData()
  const view = products.map(product => `
    <article class="menu__cards--card">
      <div class="card-image">
        <img class="card-image__option-image" src="${product.image}" alt="menu-option">
      </div>
      <div class="card-description">
        <div class="card-description__text">
          <h3>${product.priceCLP}</h3>
          <p>${product.quantity}</p>
          <p>${product.description}</p>
        </div>
        <div class="card-description__button">
          <div class="card-description__button--button">
            <a href="#"><span>¡Lo Quiero!</span></a>
          </div>
        </div>
      </div>
    </article>
    `).join('')
  return view
}

export default ProductsCards