/**
 * @fileoverview Utilidad para obtener los datos de los productos del menú.
 *
 * Este módulo importa estáticamente el catálogo de productos desde un archivo
 * JSON local y lo expone de forma asíncrona para mantener una interfaz
 * uniforme con otras utilidades que sí realizan peticiones remotas.
 *
 * @module utils/getData
 */

/**
 * Datos del catálogo de productos importados desde el archivo JSON local.
 * Cada objeto del arreglo representa un producto disponible en el menú
 * con su nombre, precio en CLP, cantidad, descripción, imagen y categoría.
 *
 * @type {Array<{
 *   id: number,
 *   name: string,
 *   priceCLP: number|null,
 *   quantity: string,
 *   description: string,
 *   image: string,
 *   category: string,
 *   available: boolean,
 *   contactRequired?: boolean
 * }>}
 */
import data from '../data/products.json'

/**
 * Retorna el catálogo completo de productos del menú.
 *
 * La función encuelve los datos en una Promesa resuelta inmediatamente
 * para permitir que los consumidores la traten como una llamada asíncrona,
 * facilitando una eventual migración a una API remota sin cambiar
 * la interfaz de uso.
 *
 * @async
 * @function getData
 * @returns {Promise<Array<Object>>} Promesa que resuelve con el arreglo
 *   completo de objetos de producto definidos en `products.json`.
 *
 * @example
 * import getData from './utils/getData.js'
 *
 * const products = await getData()
 * console.log(products[0].name) // 'Hallaca individual'
 */
export default async function getData() {
  return Promise.resolve(data)
}