// --- DOM Utilities ---
const $ = sel => document.getElementById(sel);
const $qs = (el, sel) => el.querySelector(sel);
const $ce = tag => document.createElement(tag);
const $empty = el => (el.innerHTML = '');
// --- DOM Elements ---
const recordButton = $('recordButton');
const sendButton = $('sendButton');
const textInput = $('textInput');
const statusDiv = $qs($('status'), 'span');
const recordingIndicator = $('recordingIndicator');
const chatContainer = $('chatContainer');
const deleteButton = $('deleteButton');
const channelList = $('channelList');
const hamburgerButton = $('hamburgerButton');
const sidebar = $('sidebar');
const closeSidebarButton = $('closeSidebarButton');
const searchInput = $('searchInput');
const emptyChatText = $('empty-chat-text');

// --- State ---
let mediaRecorder,
	audioChunks = [],
	currentAudio = null;
let isPlaying = false,
	isRecording = false;
let stream = null,
	silenceCheckId = null,
	silenceTimeoutId = null;
let isSidebarOpen = false;
let currentChannelId;
let touchStartX = 0,
	touchMoveX = 0;
let tooltip = null;
let isHoverTooltip = false;
let currentTarget = null;
let pendingChannelId; // This will be used to store the channelId from the URL, when channel could not be found on list. on populating list, will be selected.

const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const SenderType = {
	AI: 'AI',
	USER: 'USER',
};
const placeholder = textInput.getAttribute('placeholder');

// --- Event Listeners ---

window.addEventListener('DOMContentLoaded', () => {
	fetchChannelsAndModels();
	updateInputBarPosition();
	onWindowPopState();
	searchInput.value = '';
	if (!isMobile) {
		toggleSidebar();
	}
	setTimeout(() => {
		chatContainer.dispatchEvent(new Event('input', { bubbles: true }));
	}, 100);
	setTimeout(() => {
		chatContainer.dispatchEvent(new Event('input', { bubbles: true }));
	}, 1000);
});

const modelsButton = $('modelsButton');
const dropdown = $('models-dropdown').parentElement;

modelsButton.addEventListener('click', function () {
	dropdown.classList.toggle('hidden');
});

document.addEventListener('click', function (event) {
	if (
		!modelsButton.contains(event.target) &&
		!dropdown.contains(event.target)
	) {
		dropdown.classList.add('hidden');
	}
});

sendButton.addEventListener('click', handleSendText);
recordButton.addEventListener('click', handleRecordButton);
deleteButton.addEventListener('click', showDeleteModal);
hamburgerButton.addEventListener('click', toggleSidebar);
document.body.addEventListener('touchstart', handleTouchStart, false);
document.body.addEventListener('touchmove', handleTouchMove, false);
document.body.addEventListener('touchend', handleTouchEnd, false);
function updateButtonState() {
	const currentText = textInput.innerText.trim();
	sendButton.disabled = currentText === '' || currentText === placeholder;
}

textInput.addEventListener('keydown', e => {
	if (e.key === 'Enter') {
		if (e.shiftKey) return;
		e.preventDefault();
		handleSendText();
	}
});

textInput.addEventListener('input', updateButtonState);

textInput.addEventListener('focus', () => {
	if (textInput.innerText === placeholder) {
		textInput.innerText = '';
	}
	updateButtonState();
});

textInput.addEventListener('blur', () => {
	if (textInput.innerText.trim() === '') {
		textInput.innerText = placeholder;
	}
	updateButtonState();
});

textInput.innerText = placeholder;
updateButtonState();

closeSidebarButton.addEventListener('click', closeSidebar);

document.addEventListener('click', e => {
	const channelContainer = e.target.closest('.channel-container');
	if (channelContainer) {
		const selectedButton =
			channelContainer.querySelector('.channel-button');
		if (selectedButton) {
			selectChannel(selectedButton);
			if (isMobile) {
				closeSidebar();
			}
		}
	}
});

sendButton.addEventListener('mouseover', () => {
	showHoverTooltip(sendButton, 'Send');
});
recordButton.addEventListener('mouseover', () => {
	showHoverTooltip(recordButton, 'Record');
});

function activateSendButton() {
	sendButton.classList.add('opacity-100');
}

function deactivateSendButton() {
	sendButton.classList.remove('opacity-100');
	sendButton.classList.add('opacity-70');
}

deactivateSendButton();

// --- Main Handlers ---
async function handleSendText() {
	if (isPlaying && currentAudio) {
		stopAudio();
		return;
	}

	const value = textInput.innerHTML;
	const text = value
		.replace(/<br\s*\/?>/gi, '')
		.replace(/&nbsp;/g, ' ')
		.trim();
	if (!text) return;

	textInput.innerHTML = '';
	appendMessage(SenderType.USER, text);
	statusDiv.textContent = 'Sending text...';
	const formData = new FormData();
	formData.append('text', text);
	updateInputBarPosition();
	toggleSendButton(true);
	await processChatRequest(formData);
}

async function handleRecordButton() {
	console.log(isRecording);
	isRecording ? stopRecording() : await startRecording();
}

// --- Request/Response Logic ---
async function requestJSON(url, options = {}) {
	const r = await fetch(url, options);
	if (!r.ok) throw r;
	return r.json();
}

async function processChatRequest(formData) {
	try {
		if (currentChannelId) {
			formData.append('channel_id', currentChannelId);
		}
		const usedChannel = currentChannelId;
		const selectedModel = getSelectedModel();
		if (selectedModel) {
			formData.append('model', selectedModel);
		}

		const response = await fetch('/api/chat', {
			method: 'POST',
			body: formData,
		});
		if (!response.ok) {
			if (response.status === 404) {
				appendMessage(
					SenderType.AI,
					'No models found on server.',
					false,
					true
				);
				return;
			}
			appendMessage(
				SenderType.AI,
				'Failed to get response from the AI.' + response.textContent,
				false,
				true
			);
			return;
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let accumulatedText = '';
		let audioUrl = null;
		let messageStarted = false;

		const buffer = createBuffer(text => {
			if (usedChannel === currentChannelId) {
				if (!messageStarted) {
					appendMessage(SenderType.AI, text, true);
					messageStarted = true;
				} else {
					appendMessage(SenderType.AI, text, true);
				}
			}
			accumulatedText += text;
		});

		statusDiv.textContent = 'Receiving response...';

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			const { text, foundAudioUrl, foundResolvedText } =
				processChunk(chunk);

			if (foundResolvedText) {
				buffer.flushNow();
				appendMessage(SenderType.USER, foundResolvedText, false);
				continue;
			}

			if (text !== undefined && text !== null) {
				buffer.append(text);
			}

			if (foundAudioUrl) {
				audioUrl = foundAudioUrl;
			}
		}

		buffer.flushNow();
		statusDiv.textContent = '';
		if (usedChannel === currentChannelId) {
			if (audioUrl) {
				await playResponseAudio(audioUrl);
			}
			finalizeStreamingBubble(accumulatedText, audioUrl);
		}
	} catch (error) {
		statusDiv.textContent = '';
		console.error('Error processing chat request:', error);
	}
}

function createBuffer(onFlush, smoothness = 50) {
	let buffer = '';
	let timer = null;

	const flush = () => {
		if (buffer.trim() !== '') {
			onFlush(buffer);
			buffer = '';
		}
	};

	const schedule = () => {
		if (timer !== null) clearTimeout(timer);

		if (buffer.length >= 10 || /[.?!\s]/.test(buffer.slice(-1))) {
			flush();
		} else {
			timer = setTimeout(flush, smoothness);
		}
	};

	const append = text => {
		buffer += text;
		schedule();
	};

	const flushNow = () => {
		if (timer !== null) clearTimeout(timer);
		flush();
	};

	return { append, flushNow };
}

function processChunk(chunk) {
	const JSON_START = '$[[START_JSON]]';
	const JSON_END = '$[[END_JSON]]';
	const AUDIO_START = '$[[AUDIO_DONE]]';
	const AUDIO_END = '$[[AUDIO_DONE]]';

	let foundAudioUrl = null;
	let foundResolvedText = null;
	let remainingText = chunk;

	const jsonStartIndex = chunk.indexOf(JSON_START);
	const jsonEndIndex = chunk.indexOf(JSON_END);

	if (
		jsonStartIndex !== -1 &&
		jsonEndIndex !== -1 &&
		jsonEndIndex > jsonStartIndex
	) {
		const jsonChunk = chunk.substring(
			jsonStartIndex + JSON_START.length,
			jsonEndIndex
		);
		try {
			const parsedJson = JSON.parse(jsonChunk);
			if (parsedJson.resolved_text)
				foundResolvedText = parsedJson.resolved_text;
		} catch {}
		remainingText =
			chunk.slice(0, jsonStartIndex) +
			chunk.slice(jsonEndIndex + JSON_END.length);
	}

	const audioStartIndex = remainingText.indexOf(AUDIO_START);
	const audioEndIndex = remainingText.indexOf(
		AUDIO_END,
		audioStartIndex + AUDIO_START.length
	);

	if (
		audioStartIndex !== -1 &&
		audioEndIndex !== -1 &&
		audioEndIndex > audioStartIndex
	) {
		const audioChunk = remainingText.substring(
			audioStartIndex + AUDIO_START.length,
			audioEndIndex
		);
		try {
			const parsedAudio = JSON.parse(audioChunk);
			if (parsedAudio.audio_url) foundAudioUrl = parsedAudio.audio_url;
			if (parsedAudio.channel_id) {
				addChannel(parsedAudio.channel_id);
				pushState(channelId);
			}
		} catch {}
		remainingText =
			remainingText.slice(0, audioStartIndex) +
			remainingText.slice(audioEndIndex + AUDIO_END.length);
	}

	return {
		text: remainingText,
		foundAudioUrl,
		foundResolvedText,
	};
}

function pushState(channelId) {
	if (channelId && channelId !== currentChannelId) {
		currentChannelId = channelId;
		window.history.pushState(null, null, `/c/${channelId}`);
	}
}

function finalizeStreamingBubble(accumulatedText, audioUrl) {
	const streamBubble = $('response-stream-bubble');
	if (streamBubble) {
		const md = window.markdownit();
		streamBubble.innerHTML = md.render(accumulatedText);
		streamBubble.removeAttribute('id');
		addToolbarOnMessage(streamBubble, accumulatedText, audioUrl);
	}
}
async function fetchAndRenderHistory(channelId) {
	try {
		currentChannelId = channelId;
		pushState(channelId);
		const data = await requestJSON(`/api/history/${channelId}`);
		$empty(chatContainer);

		if (Array.isArray(data.history)) {
			data.history.forEach(msg => {
				const sender =
					msg.role.toUpperCase() === SenderType.USER
						? SenderType.USER
						: SenderType.AI;
				appendMessage(sender, msg.content, false, false, msg.audio_url);
			});
		} else {
			appendMessage(SenderType.AI, '');
		}
		stopRecording();
		stopAudio();
		setTimeout(() => {
			updateInputBarPosition();
		}, 0);
	} catch {}
}

async function fetchChannelsAndModels() {
	try {
		const data = await requestJSON('/api/data');

		if (Array.isArray(data.channels)) {
			$empty(channelList);
			populateChannels(data.channels);
		} else {
			showNoHistoryText();
		}

		const models = data.models;
		if (Array.isArray(models) && models.length > 0) {
			const selected = localStorage.getItem('selectedModel');
			const modelNames = models.map(m => m.name);
			const shouldReset = !selected || !modelNames.includes(selected);

			const defaultModelName = shouldReset ? models[0].name : selected;
			localStorage.setItem('selectedModel', defaultModelName);
			modelsButton.textContent = defaultModelName;

			const modelsDropdown = $('models-dropdown');
			modelsDropdown.innerHTML = '';

			models.forEach(m => {
				const model = $ce('li');
				model.className = 'px-4 py-2 hover:bg-blue-800 cursor-pointer';
				model.textContent = m.name;
				modelsDropdown.appendChild(model);
				model.addEventListener('click', () => {
					selectModel(m.name);
				});
			});
		} else {
			modelsButton.textContent = 'No models available';
		}
	} catch (e) {
		if (e.status === 404) {
			showNoHistoryText();
		} else {
			console.error('Failed to fetch channels:', e);
		}
	}
}

function selectModel(name) {
	modelsButton.textContent = name;
	dropdown.classList.toggle('hidden');
	localStorage.setItem('selectedModel', name);
}
function isModelSelected(model) {
	const selected = localStorage.getItem('selectedModel');
	if (!selected) return false;
	return selected === model;
}
function getSelectedModel() {
	return localStorage.getItem('selectedModel');
}
function isAnyModelSelected() {
	const selected = localStorage.getItem('selectedModel');
	return selected != null;
}

function selectChannel(selectedButton) {
	const buttons = Array.from(
		channelList.querySelectorAll('.channel-button')
	).filter(btn => btn.id !== 'noHistoryButton');
	buttons.forEach(btn => btn.parentNode.classList.remove('selected-channel'));
	if (selectedButton) {
		selectedButton.parentNode.classList.add('selected-channel');
		const channelId = selectedButton.id;

		if (channelId) {
			fetchAndRenderHistory(channelId);
		}
	}
	stopAudio();
	stopRecording();
}

function onWindowPopState() {
	requestAnimationFrame(() => {
		const channelId = window.location.pathname.split('/').pop();
		if (channelId && channelId !== currentChannelId) {
			console.log('Found channelId from URL:', channelId);
			const selectedButton = channelList.querySelector(
				`li[id="${channelId}"]`
			);
			if (selectedButton) {
				console.log('Found channelId from URL:', selectedButton);
				selectChannel(selectedButton);
			} else {
				pendingChannelId = channelId;
			}
		}
	});
}

function showNoHistoryText() {
	populateChannels();
	const li = $ce('li');
	li.className = 'mb-3';
	li.innerHTML = `<button id="noHistoryButton" class="channel-button">No history available</button>`;
	channelList.appendChild(li);
}
async function deleteChannelHistory(channelId) {
	try {
		const response = await fetch(`/api/history/${channelId}/`, {
			method: 'DELETE',
		});
		if (!response.ok) throw new Error('Failed to delete history');
		const channel = channelList.querySelector(`li[id="${channelId}"]`);
		if (channel) {
			channel.remove();
		}

		if (currentChannelId && channelId === currentChannelId) {
			$empty(chatContainer);
			currentChannelId = '';
			stopAudio();
		}
	} catch (error) {
		console.error('Error deleting history:', error);
		alert(
			'An error occurred while deleting the chat history. Please try again.'
		);
	}
}

async function deleteAllHistory() {
	try {
		const response = await fetch('/api/history/delete-all', {
			method: 'DELETE',
		});
		if (!response.ok) throw new Error('Failed to delete history');
		$empty(chatContainer);
		$empty(channelList);
		populateChannels();

		stopAudio();
	} catch (error) {
		console.error('Error deleting history:', error);
		alert(
			'An error occurred while deleting the chat history. Please try again.'
		);
	}
}

function addChannel(channelId, channelName) {
	const li = $ce('li');
	li.className = 'mb-3 channel-item';
	li.id = channelId;

	li.innerHTML = `
  <div class="channel-container">
      <button class="channel-button" id="${channelId}">
      ${channelName}
      </button>
      <button class="channel-dropdown-button">...</button>
  </div>
  `;

	const channelButton = li.querySelector('.channel-button');
	channelButton.addEventListener('click', e => {
		e.stopPropagation();
		selectChannel(channelButton);
	});

	const dropdownButton = li.querySelector('.channel-dropdown-button');
	const dropdownMenu = $ce('div');
	dropdownMenu.className = 'channel-dropdown-menu fixed hidden';
	dropdownMenu.innerHTML = `
  <button class="delete-channel-button">
      <i style="color:red;"class="fas fa-trash"></i> Delete
  </button>
  `;

	document.body.appendChild(dropdownMenu);

	dropdownButton.addEventListener('click', e => {
		e.stopPropagation();
		const rect = dropdownButton.getBoundingClientRect();
		dropdownMenu.style.top = `${rect.bottom + window.scrollY}px`;
		dropdownMenu.style.left = `${rect.left + window.scrollX}px`;
		dropdownMenu.classList.toggle('hidden');
	});

	const deleteButton = dropdownMenu.querySelector('.delete-channel-button');
	deleteButton.addEventListener('click', () => {
		deleteChannelHistory(channelId);
		dropdownMenu.classList.add('hidden');
	});

	document.addEventListener('click', e => {
		if (!dropdownMenu.contains(e.target) && e.target !== dropdownButton) {
			dropdownMenu.classList.add('hidden');
		}
	});

	channelList.appendChild(li);

	if (pendingChannelId && pendingChannelId === channelId) {
		selectChannel(channelButton);
		pendingChannelId = null;
	}
}

function populateChannels(channels) {
	channelList.innerHTML = '';

	const newChatLiContainer = $ce('div');
	newChatLiContainer.className = 'new-channel-container channel-container';
	newChatLiContainer.style.backgroundColor = '#2F2F2F';
	newChatLiContainer.style.borderRadius = '50px';

	const newChatLi = $ce('li');
	newChatLi.className = 'mb-3';
	newChatLi.innerHTML = `
      <button class="new-channel-button channel-button">New Chat</button>
  `;

	newChatLiContainer.addEventListener('click', () => {
		chatContainer.innerHTML = '';
		currentChannelId = '';
		history.pushState(null, null, '/');
		updateInputBarPosition();
		if (isMobile) closeSidebar();
	});

	newChatLiContainer.appendChild(newChatLi);
	channelList.insertBefore(newChatLiContainer, channelList.firstChild);

	if (!channels || channels.length === 0) {
		return;
	}

	channels.forEach(channel => {
		addChannel(channel.id, channel.name);
	});
}

// --Search Handling ---
searchInput.addEventListener('input', () => {
	const val = searchInput.value.trim();
	const filter = val.toLowerCase();
	const channels = channelList.querySelectorAll('li');

	channels.forEach(channel => {
		const button = channel.querySelector('.channel-button');
		if (
			!filter ||
			(button &&
				button.classList.contains('new-channel-container') &&
				button.textContent.toLowerCase().includes(filter))
		) {
			channel.style.display = '';
		} else {
			channel.style.display = 'none';
		}
	});
});

let streamingBubble = null;
let streamingText = '';

function appendMessage(
	sender,
	text,
	streaming = false,
	isRed = false,
	audioUrl = ''
) {
	const isAI = sender === SenderType.AI;

	if (streaming && isAI) {
		if (!streamingBubble) {
			streamingBubble = $ce('div');
			streamingBubble.id = 'response-stream-bubble';
			streamingBubble.className =
				'p-3 rounded self-start mr-auto max-w-fit break-words message-animate ai-streaming';
			streamingBubble.style.backgroundColor = 'transparent';
			streamingBubble.style.marginBottom = '0.5rem';

			const codeBlock = $ce('pre');
			const codeInner = $ce('code');
			codeBlock.appendChild(codeInner);
			streamingBubble.appendChild(codeBlock);

			chatContainer.appendChild(streamingBubble);
		}

		streamingText += text;
		const codeEl = streamingBubble.querySelector('code');
		codeEl.textContent = streamingText;

		chatContainer.scrollTop = chatContainer.scrollHeight;
		return;
	}

	let bubble;

	if (streamingBubble && streaming && isAI) {
		bubble = streamingBubble;
		streamingBubble = null;

		const md = window.markdownit();
		bubble.innerHTML = md.render(streamingText);
		if (isRed) bubble.style.color = 'red';
		addToolbarOnMessage(bubble, streamingText, audioUrl);

		streamingText = '';
	} else {
		bubble = $ce('div');
		bubble.className = `p-3 rounded ${sender === SenderType.USER ? 'self-end ml-auto' : 'self-start mr-auto'} max-w-fit break-words message-animate`;
		bubble.style.backgroundColor =
			sender === SenderType.USER ? '#303030' : 'transparent';
		bubble.style.marginBottom = '0.5rem';

		const md = window.markdownit();
		bubble.innerHTML = md.render(text);
		if (isRed) bubble.style.color = 'red';

		chatContainer.appendChild(bubble);
		addToolbarOnMessage(bubble, text, audioUrl);
	}

	chatContainer.scrollTop = chatContainer.scrollHeight;
	if (window.MathJax) MathJax.typesetPromise([bubble]);
}

channelList.addEventListener('click', event => {
	if (event.target.classList.contains('channel-dropdown-button')) {
		const dropdownMenu = event.target.nextElementSibling;
		if (dropdownMenu) {
			dropdownMenu.classList.toggle('hidden');
		}
	}
});

function updateInputBarPosition() {
	const inputBarContainer = $('inputBottomBar');
	if (!chatContainer.innerHTML.trim()) {
		console.log('Is empty ' + new Date());

		chatContainer.classList.add('empty');
		textInput.classList.add('chat-container-empty');
		emptyChatText.style.display = 'flex';
		inputBottomBar.classList.remove('input-bar-centered');
	} else {
		console.log('Removing empty ' + new Date());
		chatContainer.classList.remove('empty');
		emptyChatText.style.display = 'none';

		textInput.classList.remove('chat-container-empty');
		inputBottomBar.classList.add('input-bar-centered');
	}
}

function toggleSendButton(playing) {
	isPlaying = playing;
	sendButton.innerHTML = playing
		? '<i class="fas fa-stop"></i>'
		: '<i class="fas fa-paper-plane"></i>';
}

function toggleRecordButton(recording) {
	recordButton.classList.toggle('bg-green-600', !recording);
	recordButton.classList.toggle('hover:bg-green-700', !recording);
	recordButton.classList.toggle('bg-red-600', recording);
	recordButton.classList.toggle('hover:bg-red-700', recording);
	recordButton.innerHTML = recording
		? '<i class="fas fa-stop"></i>'
		: '<i class="fas fa-microphone"></i>';
}
async function playResponseAudio(url) {
	currentAudio = new Audio(url);
	currentAudio.onended = () => {
		isPlaying = false;
		toggleSendButton(false);
	};
	isPlaying = true;
	toggleSendButton(true);
	await currentAudio.play();
}

function showDeleteModal() {
	const modal = $ce('div');
	modal.className =
		'fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50';
	const modalContent = $ce('div');
	modalContent.style.borderRadius = '15px';
	modalContent.style.backgroundColor = '#2F2F2F';
	modalContent.className = ' text-white p-6 rounded shadow-lg text-center';
	modalContent.innerHTML = `<strong>Are you sure you want to delete the chat history?</strong>`;

	const buttonContainer = $ce('div');
	buttonContainer.className = 'mt-4 flex justify-center gap-4';

	const confirmButton = $ce('button');
	confirmButton.textContent = 'Confirm';
	confirmButton.className =
		'bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition';
	confirmButton.style.borderRadius = '50px';

	const cancelButton = $ce('button');
	cancelButton.textContent = 'Cancel';
	cancelButton.className =
		'text-white px-4 py-2 rounded hover:bg-gray-700 transition';
	cancelButton.style.border = '2px solid gray';
	cancelButton.style.borderRadius = '50px';
	buttonContainer.append(cancelButton, confirmButton);
	modalContent.appendChild(buttonContainer);
	modal.appendChild(modalContent);
	document.body.appendChild(modal);

	confirmButton.onclick = async () => {
		try {
			await deleteAllHistory();
			document.body.removeChild(modal);
		} catch (error) {
			console.error('Error confirming delete:', error);
		}
	};

	cancelButton.onclick = () => document.body.removeChild(modal);
}

// --- Touch Sidebar Handling ---
function handleTouchStart(e) {
	touchStartX = e.touches[0].clientX;
}
function handleTouchMove(e) {
	touchMoveX = e.touches[0].clientX;
	if (touchMoveX - touchStartX > 50 && !isSidebarOpen) openSidebar();
	else if (touchStartX - touchMoveX > 50 && isSidebarOpen) closeSidebar();
}
function handleTouchEnd() {
	if (Math.abs(touchMoveX - touchStartX) < 50 && isSidebarOpen)
		closeSidebar();
}

function openSidebar() {
	hamburgerButton.classList.add('hidden');

	sidebar.style.transform = 'translateX(0)';
	isSidebarOpen = true;
	setTimeout(() => {
		chatContainer.dispatchEvent(new Event('input', { bubbles: true }));
	}, 100);
}
function closeSidebar() {
	hamburgerButton.classList.remove('hidden');

	sidebar.style.transform = 'translateX(-100%)';
	isSidebarOpen = false;
	setTimeout(() => {
		chatContainer.dispatchEvent(new Event('input', { bubbles: true }));
	}, 100);
}
function toggleSidebar() {
	isSidebarOpen ? closeSidebar() : openSidebar();
}

// --- Audio Recording Logic ---
async function startRecording() {
	if (!navigator.mediaDevices?.getUserMedia) {
		alert('Media devices not supported in this browser');
		return;
	}

	try {
		stream = await navigator.mediaDevices.getUserMedia({ audio: true });

		const mimeTypePreference = [
			'audio/webm;codecs=opus',
			'audio/mp4',
			'audio/webm',
			'audio/ogg;codecs=opus',
			'audio/wav',
			'audio/mp3',
		];

		let supportedMimeType = null;
		for (const mimeType of mimeTypePreference) {
			if (MediaRecorder.isTypeSupported(mimeType)) {
				supportedMimeType = mimeType;
				break;
			}
		}

		appendMessage(SenderType.AI, 'Using mime type: ' + supportedMimeType);
		updateInputBarPosition();

		if (!supportedMimeType) {
			alert('No supported audio format available on this browser.');
			return;
		}

		let options = { mimeType: supportedMimeType };

		if (supportedMimeType.includes('webm')) {
			options.audioBitsPerSecond = 128000;
		}

		mediaRecorder = new MediaRecorder(stream, options);
		audioChunks = [];

		mediaRecorder.ondataavailable = e => {
			if (e.data.size) audioChunks.push(e.data);
		};

		const minimumRecordingTimeMs = 1000;
		let recordingStartTime = Date.now();

		mediaRecorder.onstop = async () => {
			if (audioChunks.length === 0) return;

			const recordingDuration = Date.now() - recordingStartTime;
			if (
				recordingDuration < minimumRecordingTimeMs &&
				supportedMimeType.includes('webm')
			) {
				appendMessage(
					SenderType.AI,
					'Recording too short, please record for at least 1 second'
				);
				audioChunks = [];
				return;
			}

			const blob = new Blob(audioChunks, { type: supportedMimeType });

			try {
				const formData = new FormData();

				formData.append('file', blob, 'audio.wav');
				statusDiv.textContent = 'Processing audio...';

				await processChatRequest(formData);
			} catch (error) {
				appendMessage(
					SenderType.AI,
					'Error processing audio: ' + error.message
				);
			}
		};

		updateInputBarPosition();

		mediaRecorder.start(100);
		recordingStartTime = Date.now();

		setupSilenceDetection(stream);
		isRecording = true;
		statusDiv.textContent = 'Listening...';
		recordingIndicator.classList.remove('hidden');
		toggleRecordButton(true);
	} catch (err) {
		console.error('Recording error:', err);
		alert('Error starting recording: ' + err.message);
	}
}

function stopRecording() {
	if (!mediaRecorder || !stream) return;
	mediaRecorder.stop();
	stream.getTracks().forEach(track => track.stop());
	silenceCheckId && cancelAnimationFrame(silenceCheckId);
	silenceTimeoutId && clearTimeout(silenceTimeoutId);
	isRecording = false;
	toggleRecordButton(false);
	recordingIndicator.classList.add('hidden');
	statusDiv.textContent = '';
}

function setupSilenceDetection(stream) {
	const ctx = new AudioContext();
	const src = ctx.createMediaStreamSource(stream);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	src.connect(analyser);
	const arr = new Uint8Array(analyser.frequencyBinCount);
	const check = () => {
		analyser.getByteTimeDomainData(arr);
		const silent = arr.every(v => v > 125 && v < 130);
		if (!silent && silenceTimeoutId) {
			clearTimeout(silenceTimeoutId);
			silenceTimeoutId = null;
		}
		if (silent && !silenceTimeoutId) {
			silenceTimeoutId = setTimeout(stopRecording, 1500);
		}
		silenceCheckId = requestAnimationFrame(check);
	};
	silenceCheckId = requestAnimationFrame(check);
}

function stopAudio() {
	if (currentAudio) {
		currentAudio.pause();
		currentAudio.currentTime = 0;
	}
	isPlaying = false;
	toggleSendButton(false);
}

function addVolumeButton(toolbar, audioUrl) {
	if (!toolbar || !audioUrl) return;

	const volumeWrapper = $ce('span');
	volumeWrapper.className = 'relative inline-block';

	const volume1 = $ce('i');
	volume1.className = 'fa-solid fa-volume-high cursor-pointer ml-2';
	const volume2 = $ce('i');
	volume2.className = 'fa-solid fa-volume-low cursor-pointer ml-2';
	volume2.style.display = 'none';

	volumeWrapper.appendChild(volume1);
	volumeWrapper.appendChild(volume2);

	let isPlaying = false;
	let audio;
	let blinkInterval;

	const toggleBlink = () => {
		if (volume1.style.display === 'none') {
			volume1.style.display = 'inline-block';
			volume2.style.display = 'none';
		} else {
			volume1.style.display = 'none';
			volume2.style.display = 'inline-block';
		}
	};

	const stopBlink = () => {
		clearInterval(blinkInterval);
		volume1.style.display = 'inline-block';
		volume2.style.display = 'none';
	};

	const onClick = () => {
		if (isPlaying) {
			audio.pause();
			return;
		}

		audio = new Audio(audioUrl);
		audio.play();

		audio.onplaying = () => {
			isPlaying = true;
			blinkInterval = setInterval(toggleBlink, 1000);
		};

		audio.onpause = () => {
			isPlaying = false;
			stopBlink();
		};

		audio.onended = () => {
			isPlaying = false;
			stopBlink();
		};
	};

	volume1.onclick = onClick;
	volume2.onclick = onClick;

	volume1.addEventListener('mouseover', () => {
		showHoverTooltip(volume1, 'Read aloud');
	});

	volume2.addEventListener('mouseover', () => {
		showHoverTooltip(volume2, 'Read aloud');
	});

	toolbar.appendChild(volumeWrapper);
}

function addCopyButton(toolbar, text) {
	const copyButton = $ce('i');
	copyButton.className = 'fa-solid fa-copy cursor-pointer ml-2';
	copyButton.onclick = event => {
		copyText(event, text);
	};
	copyButton.addEventListener('mouseover', () => {
		showHoverTooltip(copyButton, 'Copy');
	});

	toolbar.appendChild(copyButton);
}

function createToolbar() {
	const toolbar = $ce('div');
	toolbar.style.display = 'flex';
	toolbar.style.flexDirection = 'row';
	toolbar.style.gap = '0.5rem';
	toolbar.style.marginTop = '0.5rem';
	toolbar.style.alignItems = 'center';
	return toolbar;
}

function addToolbarOnMessage(element, text, audioUrl) {
	const toolbar = createToolbar();
	addCopyButton(toolbar, text);
	addVolumeButton(toolbar, audioUrl);
	element.appendChild(toolbar);
}

document.addEventListener('mouseover', async function (event) {
	const target = event.target;
	if (!target || target.className != 'tooltip' || target === currentTarget)
		return;

	currentTarget = target;
	const name = target.id;

	if (!name) return;

	let tooltipText = name;

	createTooltip(target, tooltipText);
	isHoverTooltip = true;
});

document.addEventListener('mouseout', function (event) {
	if (tooltip && isHoverTooltip && event.relatedTarget !== tooltip) {
		tooltip.remove();
		tooltip = null;
		isHoverTooltip = false;
		currentTarget = null;
	}
});

function copyText(event, text) {
	if (navigator.clipboard) navigator.clipboard.writeText(text);
	createTooltip(event.target, 'Copied!');

	isHoverTooltip = false;
	setTimeout(() => tooltip?.remove(), 1200);
}

function createTooltip(target, tooltipText, positionOffset = { x: 0, y: 0 }) {
	if (!tooltipText) return;

	tooltip?.remove();
	tooltip = $ce('div', { className: 'tooltip', textContent: tooltipText });
	tooltip.className = 'tooltip';
	tooltip.textContent = tooltipText;
	document.body.appendChild(tooltip);

	const targetRect = target.getBoundingClientRect();
	let tooltipLeft =
		targetRect.left +
		targetRect.width / 2 -
		tooltip.offsetWidth / 2 +
		positionOffset.x;
	let tooltipTop =
		targetRect.top - tooltip.offsetHeight - 8 + positionOffset.y;

	tooltipLeft = Math.max(
		10,
		Math.min(tooltipLeft, window.innerWidth - tooltip.offsetWidth - 10)
	);
	tooltipTop = Math.max(
		10,
		Math.min(tooltipTop, window.innerHeight - tooltip.offsetHeight - 10)
	);

	tooltip.style.left = `${tooltipLeft}px`;
	tooltip.style.top = `${tooltipTop}px`;

	tooltip.style.visibility = 'visible';
	tooltip.style.opacity = '1';
	tooltip.style.zIndex = '1000';
	tooltip.style.pointerEvents = 'none';
}

function showHoverTooltip(target, tooltipText) {
	createTooltip(target, tooltipText);
	isHoverTooltip = true;
}
