import getSocials from '../utils/getSocials.js'

const SocialCards = async function () {
  const socials = await getSocials()
  const view = socials.map(social => `
    <div style="background-color: ${social.backgroundColor};" class="contact-card__social-media__item">
      <a class="" href="${social.url}" target="_blank" rel="noopener noreferrer" aria-label="${social.name}">
      <img src="${social.icon}" alt="${social.alt || social.name}">  
      <p>${social.name}</p>
      </a>
    </div>
    `).join('')
  return view
}

export default SocialCards