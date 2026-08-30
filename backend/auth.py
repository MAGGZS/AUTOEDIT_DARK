"""
Ponto de entrada da autenticação — hoje de uma pessoa só, amanhã de várias.

O FLAXY ainda não tem contas. Mas toda rota que um dia vai precisar saber "de
quem é isso" já declara `user: CurrentUser = Depends(current_user)` e já grava
`owner_id` nas linhas que cria. Assim, quando o login existir, muda-se a
implementação de `current_user` e as rotas ficam como estão — em vez de uma
varredura por todos os endpoints, que é onde se esquece um e vaza dado de
outra pessoa.

Ver `db/schema.postgres.sql` para o modelo completo de usuários.
"""
import secrets
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, Query, status

from settings import settings

# Dono de tudo que foi criado antes de existirem contas. É um UUID fixo para que
# a migração futura consiga atribuir o acervo existente a um usuário real com um
# único UPDATE, em vez de adivinhar por data de criação.
LOCAL_OWNER_ID = "00000000-0000-0000-0000-000000000001"


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: Optional[str] = None
    role: str = "owner"
    #: True enquanto não houver login de verdade.
    is_anonymous: bool = True

    @property
    def is_admin(self) -> bool:
        return self.role in ("owner", "admin")


LOCAL_USER = CurrentUser(id=LOCAL_OWNER_ID, email=None, role="owner", is_anonymous=True)


def check_key(value: str | None) -> bool:
    """Compara a chave em tempo constante, para não vazar o prefixo correto."""
    if not settings.API_KEY:
        return True
    return bool(value) and secrets.compare_digest(value, settings.API_KEY)


async def require_api_key(
    x_flaxy_key: str | None = Header(default=None),
    key: str | None = Query(default=None),
) -> None:
    """
    Porteiro interino para o backend público.

    Sem `FLAXY_API_KEY` configurada não faz nada — é o caso de quem roda na
    própria máquina. Com a chave definida, exige `X-Flaxy-Key` no cabeçalho ou
    `?key=` na URL.

    A variante em query existe porque miniatura e vídeo entram na página por
    `<img src>` e `<video src>`, que não mandam cabeçalho nenhum: só com o
    header, ligar a chave quebraria todas as prévias do app. Isso coloca o
    segredo em logs de acesso e no histórico do navegador — aceitável apenas
    porque ele já vai no bundle do frontend, legível por qualquer visitante.

    Isso NÃO é autenticação: é um segredo único, compartilhado, que não
    identifica ninguém e não separa dados. Serve só para que uma URL descoberta
    por acaso não vire renderização de vídeo por conta da casa até o login
    existir.
    """
    if not settings.API_KEY:
        return
    if not (check_key(x_flaxy_key) or check_key(key)):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Chave de acesso ausente ou inválida",
            headers={"WWW-Authenticate": "X-Flaxy-Key"},
        )


async def current_user(_: None = Depends(require_api_key)) -> CurrentUser:
    """
    Quem está fazendo a requisição.

    Hoje devolve sempre o mesmo dono local. Quando houver contas, esta função
    passa a ler a sessão (cookie de refresh ou Bearer) e a consultar a tabela
    `users`; a assinatura continua a mesma.
    """
    return LOCAL_USER


def owner_filter(query, model, user: CurrentUser):
    """
    Restringe uma consulta ao acervo do usuário.

    Enquanto `owner_id` puder ser nulo (linhas criadas antes das contas), filtrar
    de verdade esconderia o acervo existente. Por isso o filtro só entra em ação
    quando o usuário deixa de ser anônimo — o dia em que ele passar a valer, as
    rotas já estarão chamando este ponto.
    """
    if user.is_anonymous:
        return query
    return query.filter(
        (model.owner_id == user.id) | (model.owner_id.is_(None))
    )
