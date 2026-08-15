ALTER TABLE "token_definitions" ALTER COLUMN "name" DROP NOT NULL;
--> statement-breakpoint
-- UIX-400: токен без персонажа обязан иметь своё имя.
--
-- `NULL` значит «зовусь как мой персонаж», а у токена без персонажа наследовать
-- не от кого: такой `NULL` дал бы объект без подписи и на карте, и в списке
-- объектов. Drizzle-kit ограничение не генерирует, оно дописано руками.
ALTER TABLE "token_definitions" ADD CONSTRAINT "token_definitions_name_check" CHECK (
  "name" IS NOT NULL OR "character_id" IS NOT NULL
);
