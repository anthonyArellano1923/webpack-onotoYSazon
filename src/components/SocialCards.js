import getSocials from '../utils/getSocials.js'

const SocialCards = async function () {
  const socials = await getSocials()
  const view = socials.map(social => `
    <div style="background-color: ${social.backgroundColor};" class="contact-card__social-media__item">
      <a href="${social.url}>
        ${social.name}
        <img src="${social.icon}" alt="${social.alt}">
      </a>
    </div>
    `).join('')
  return view
}

export default SocialCards