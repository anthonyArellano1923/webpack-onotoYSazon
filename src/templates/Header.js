const Header = () => {
  const view = `
  <header>
    <section class="title">
      <div class="title__heading">
        <h1 class="title__heading--title">Onoto y sazón!</h1>
      </div>
      <h2 class="title__subheading">Hallacas tradicionales con sabor a nuestra tierra.
      </h2>
      <div class="title__tradition-link">
        <a href="#tradition"><span>¡Conoce acá la historia de la hallaca! 📣</span></a>
      </div>      
    </section>
    <section class="buttons">
      <div class="buttons__button-container">
        <a href="#menu"><span>Menu</span></a>
      </div>
      <div class="buttons__button-container">
        <a href="#contact"><span>Contacto</span></a>
      </div> 
    </section>
  </header> 
  `
  return view
}

export default Header;