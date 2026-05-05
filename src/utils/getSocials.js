/**
 * @fileoverview Utilidad para obtener los enlaces a las redes sociales del negocio.
 *
 * Este módulo importa estáticamente la lista de plataformas sociales desde
 * un archivo JSON local y la expone de forma asíncrona, manteniendo una
 * interfaz coherente con otras utilidades del proyecto.
 *
 * @module utils/getSocials
 */

/**
 * Datos de redes sociales importados desde el archivo JSON local.
 * Cada objeto del arreglo representa una plataforma social con su URL,
 * ícono, color de fondo y texto alternativo para accesibilidad.
 *
 * @type {Array<{
 *   id: string,
 *   name: string,
 *   url: string,
 *   icon: string,
 *   alt: string,
 *   backgroundColor: string
 * }>}
 */
import data from '../data/socials.json'

/**
 * Retorna el listado completo de redes sociales del negocio.
 *
 * La función encuelve los datos en una Promesa resuelta inmediatamente
 * para permitir que los consumidores la traten como una llamada asíncrona,
 * facilitando una eventual migración a una API remota sin cambiar
 * la interfaz de uso.
 *
 * @async
 * @function getSocials
 * @returns {Promise<Array<Object>>} Promesa que resuelve con el arreglo
 *   de objetos de redes sociales definidos en `socials.json`.
 *
 * @example
 * import getSocials from './utils/getSocials.js'
 *
 * const socials = await getSocials()
 * console.log(socials[0].name) // 'WhatsApp'
 * console.log(socials[0].url)  // 'https://wa.me/message/...'
 */
export default async function getSocials() {
  return Promise.resolve(data)
}