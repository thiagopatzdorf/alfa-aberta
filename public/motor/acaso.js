// Gerador pseudoaleatório com semente (mulberry32). Tudo que o motor sorteia passa por aqui:
// a mesma semente dá a mesma evolução no navegador e no servidor, e qualquer resultado
// publicado pode ser refeito por quem duvidar.
export function criarAcaso(semente = 1) {
  let a = semente >>> 0;
  const proximo = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    real: proximo,
    inteiro: (min, max) => min + Math.floor(proximo() * (max - min + 1)),
    escolher: (lista) => lista[Math.floor(proximo() * lista.length)],
    chance: (p) => proximo() < p,
  };
}
