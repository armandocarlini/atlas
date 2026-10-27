# Contribuindo com o ATLAS

O ATLAS é um projeto open source e parte do portfólio profissional de [Armando Ciciliano Carlini](https://github.com/armandocarlini). A documentação distingue o que está funcionando do que ainda é proposta.

Leia primeiro o [planejamento](ATLAS_PLANEJAMENTO_ARQUITETURA.md), o [contexto atual](docs/CONTEXTO.md), o [roadmap](docs/ROADMAP.md) e o [design system](design-system/atlas/MASTER.md). Para bugs, descreva sistema operacional, passos de reprodução, resultado esperado e resultado observado, usando dados fictícios.

## Ambiente

Use Windows, Git, Node.js 24 LTS e npm para testar o desktop completo. `npm ci` instala as versões do lockfile. Os testes de cálculo de contraste, descoberta Git e build também podem ser executados em Linux; isso não comprova suporte ao terminal desktop nesse sistema.

```powershell
npm ci
npm run dev:desktop
```

## Antes de enviar uma alteração

```powershell
npm test
npm run build
node scripts/smoke-desktop.mjs --git-only
npm run check:public
```

Para mudanças em PTY, janelas, layout ou aparência, rode também `npm run test:desktop` no Windows. O teste abre janelas e usa PowerShells reais com um perfil temporário; não o execute ao mesmo tempo que outra rodada do mesmo teste. Resultados e capturas ficam locais.

Trabalhe em uma branch própria. Descreva no pull request o problema, o comportamento final, os testes executados e as limitações relevantes. Não marque integrações de agentes como concluídas a partir dos dados ilustrativos do cockpit.

## Segurança e licença

Consulte [SECURITY.md](SECURITY.md) para relatos privados e cuidados com segredos. Suas contribuições são distribuídas sob a [licença MIT](LICENSE) do projeto.
