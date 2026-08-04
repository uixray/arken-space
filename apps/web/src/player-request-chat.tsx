import type { ChatMessageDto, PlayerRequestDto } from "@arken/contracts";
import { requestLabels } from "./player-request-ui";
import "./player-request-chat.css";

export function resolvePlayerRequestCard(
  message: ChatMessageDto,
  requests: readonly PlayerRequestDto[],
) {
  if (!message.playerRequestId) return null;
  return requests.find((request) => request.id === message.playerRequestId) ?? undefined;
}

export function PlayerRequestChatCard({ message, requests, onOpen }: {
  message: ChatMessageDto;
  requests: readonly PlayerRequestDto[];
  onOpen: () => void;
}) {
  const request = resolvePlayerRequestCard(message, requests);
  if (request === null) return null;
  if (request === undefined)
    return <div className="request-chat-card unavailable">Заявка недоступна</div>;
  return (
    <section className="request-chat-card" aria-label="Карточка заявки">
      <div className="request-chat-card-heading">
        <strong>{request.title}</strong>
        <span>{requestLabels.status[request.status]}</span>
      </div>
      <dl>
        <div><dt>Срок</dt><dd>{requestLabels.horizon[request.horizon]}</dd></div>
        <div><dt>Аудитория</dt><dd>{requestLabels.audience[request.audience]}</dd></div>
        {request.characterName && <div><dt>Персонаж</dt><dd>{request.characterName}</dd></div>}
      </dl>
      <button type="button" onClick={onOpen}>Открыть заявки</button>
    </section>
  );
}
