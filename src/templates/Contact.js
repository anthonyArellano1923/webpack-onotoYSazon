import SocialCards from '../components/SocialCards.js'

const Contact = async function () {
  const socialCards = await SocialCards()
  const view = `
    <section id="contact" class="contact">
      <div class="contact__photo-container">
        <figure class="contact__photo-container--image">
          <img src="https://i.ibb.co/d4pL3F2L/ce6d403322ab213bfe9149a41a4d7d4d.jpg" alt="chefs-photo">
        </figure>
        <h2>¡Realiza tus pedidos directamente con nosotros!</h2>
      </div>
      <div class="contact__social-cards">
        ${socialCards}
      </div>
    </section>
  `
  return view
}

export default Contact