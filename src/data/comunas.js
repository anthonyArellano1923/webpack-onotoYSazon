/**
 * @fileoverview Comunas donde se hace despacho a domicilio.
 *
 * "Santiago" acá es la ciudad (Gran Santiago), no la comuna Santiago Centro:
 * las 32 comunas de la Provincia de Santiago más Puente Alto y San Bernardo,
 * urbanamente continuas con el resto del Gran Santiago. Fuera de esta lista,
 * el cliente debe coordinar retiro.
 *
 * @module data/comunas
 */

const SANTIAGO_COMUNAS = [
  'Cerrillos', 'Cerro Navia', 'Conchalí', 'El Bosque', 'Estación Central',
  'Huechuraba', 'Independencia', 'La Cisterna', 'La Florida', 'La Granja',
  'La Pintana', 'La Reina', 'Las Condes', 'Lo Barnechea', 'Lo Espejo',
  'Lo Prado', 'Macul', 'Maipú', 'Ñuñoa', 'Pedro Aguirre Cerda', 'Peñalolén',
  'Providencia', 'Puente Alto', 'Pudahuel', 'Quilicura', 'Quinta Normal',
  'Recoleta', 'Renca', 'San Bernardo', 'San Joaquín', 'San Miguel',
  'San Ramón', 'Santiago Centro', 'Vitacura',
].sort((a, b) => a.localeCompare(b, 'es'));

export default SANTIAGO_COMUNAS;
