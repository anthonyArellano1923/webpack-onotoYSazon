import data from '../data/products.json' 

export default async function getData(){
  return Promise.resolve(data)
}