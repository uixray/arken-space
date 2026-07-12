#!/usr/bin/env sh
set -eu

cd /home/uixray/apps/arken-space
sudo -n docker compose exec -T postgres psql \
  -U arken \
  -d arken \
  -P pager=off \
  -c "select
        token.name as token,
        character.name as character,
        token_owner.display_name as token_owner,
        character_owner.display_name as character_owner
      from tokens as token
      left join characters as character on character.id = token.character_id
      left join memberships as token_owner on token_owner.id = token.owner_membership_id
      left join memberships as character_owner on character_owner.id = character.owner_membership_id
      order by token.name;"

sudo -n docker compose exec -T postgres psql \
  -U arken \
  -d arken \
  -P pager=off \
  -c "select
        membership.role,
        membership.display_name,
        character.name as character
      from memberships as membership
      left join characters as character on character.owner_membership_id = membership.id
      order by membership.created_at;"
