import React from 'react';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { FlatList, View } from 'react-native';
import { connect } from 'react-redux';
import orderBy from 'lodash/orderBy';
import { Q } from '@nozbe/watermelondb';
import { Subscription } from 'rxjs';

import * as List from '../containers/List';
import database from '../lib/database';
import RocketChat from '../lib/rocketchat';
import UserItem from '../presentation/UserItem';
import Loading from '../containers/Loading';
import I18n from '../i18n';
import log, { events, logEvent } from '../utils/log';
import SearchBox from '../containers/SearchBox';
import * as HeaderButton from '../containers/HeaderButton';
import StatusBar from '../containers/StatusBar';
import { themes } from '../constants/colors';
import { withTheme } from '../theme';
import { getUserSelector } from '../selectors/login';
import { addUser as addUserAction, removeUser as removeUserAction, reset as resetAction } from '../actions/selectedUsers';
import { showErrorAlert } from '../utils/info';
import SafeAreaView from '../containers/SafeAreaView';
import sharedStyles from './Styles';
import { ChatsStackParamList } from '../stacks/types';

const ITEM_WIDTH = 250;
const getItemLayout = (_: any, index: number) => ({ length: ITEM_WIDTH, offset: ITEM_WIDTH * index, index });

interface IUser {
	_id: string;
	name: string;
	fname: string;
	search?: boolean;
	// username is used when is from searching
	username?: string;
}
interface ISelectedUsersViewState {
	maxUsers?: number;
	search: IUser[];
	chats: IUser[];
}

interface ISelectedUsersViewProps {
	navigation: StackNavigationProp<ChatsStackParamList, 'SelectedUsersView'>;
	route: RouteProp<ChatsStackParamList, 'SelectedUsersView'>;
	baseUrl: string;
	addUser(user: IUser): void;
	removeUser(user: IUser): void;
	reset(): void;
	users: IUser[];
	loading: boolean;
	user: {
		id: string;
		token: string;
		username: string;
		name: string;
	};
	theme: string;
}

class SelectedUsersView extends React.Component<ISelectedUsersViewProps, ISelectedUsersViewState> {
	private flatlist?: FlatList;

	private querySubscription?: Subscription;

	constructor(props: ISelectedUsersViewProps) {
		super(props);
		this.init();
		const maxUsers = props.route.params?.maxUsers;
		this.state = {
			maxUsers,
			search: [],
			chats: []
		};
		const { user } = this.props;
		if (this.isGroupChat()) {
			props.addUser({ _id: user.id, name: user.username, fname: user.name });
		}
		this.setHeader(props.route.params?.showButton);
	}

	componentDidUpdate(prevProps: ISelectedUsersViewProps) {
		if (this.isGroupChat()) {
			const { users } = this.props;
			if (prevProps.users.length !== users.length) {
				this.setHeader(users.length > 0);
			}
		}
	}

	componentWillUnmount() {
		const { reset } = this.props;
		reset();
		if (this.querySubscription && this.querySubscription.unsubscribe) {
			this.querySubscription.unsubscribe();
		}
	}

	// showButton can be sent as route params or updated by the component
	setHeader = (showButton?: boolean) => {
		const { navigation, route } = this.props;
		const title = route.params?.title ?? I18n.t('Select_Users');
		const buttonText = route.params?.buttonText ?? I18n.t('Next');
		const maxUsers = route.params?.maxUsers;
		const nextAction = route.params?.nextAction ?? (() => {});
		const options = {
			title,
			headerRight: () =>
				(!maxUsers || showButton) && (
					<HeaderButton.Container>
						<HeaderButton.Item title={buttonText} onPress={nextAction} testID='selected-users-view-submit' />
					</HeaderButton.Container>
				)
		};
		navigation.setOptions(options);
	};

	// eslint-disable-next-line react/sort-comp
	init = async () => {
		try {
			const db = database.active;
			const observable = await db.collections
				.get('subscriptions')
				.query(Q.where('t', 'd'))
				.observeWithColumns(['room_updated_at']);

			// TODO: Refactor when migrate room
			this.querySubscription = observable.subscribe((data: any) => {
				const chats = orderBy(data, ['roomUpdatedAt'], ['desc']);
				this.setState({ chats });
			});
		} catch (e) {
			log(e);
		}
	};

	onSearchChangeText(text: string) {
		this.search(text);
	}

	search = async (text: string) => {
		const result = await RocketChat.search({ text, filterRooms: false });
		this.setState({
			search: result
		});
	};

	isGroupChat = () => {
		const { maxUsers } = this.state;
		return maxUsers! > 2;
	};

	isChecked = (username: string) => {
		const { users } = this.props;
		return users.findIndex(el => el.name === username) !== -1;
	};

	toggleUser = (user: IUser) => {
		const { maxUsers } = this.state;
		const {
			addUser,
			removeUser,
			users,
			user: { username }
		} = this.props;

		// Disallow removing self user from the direct message group
		if (this.isGroupChat() && username === user.name) {
			return;
		}

		if (!this.isChecked(user.name)) {
			if (this.isGroupChat() && users.length === maxUsers) {
				return showErrorAlert(I18n.t('Max_number_of_users_allowed_is_number', { maxUsers }), I18n.t('Oops'));
			}
			logEvent(events.SELECTED_USERS_ADD_USER);
			addUser(user);
		} else {
			logEvent(events.SELECTED_USERS_REMOVE_USER);
			removeUser(user);
		}
	};

	_onPressItem = (id: string, item = {} as IUser) => {
		if (item.search) {
			this.toggleUser({ _id: item._id, name: item.username!, fname: item.name });
		} else {
			this.toggleUser({ _id: item._id, name: item.name, fname: item.fname });
		}
	};

	_onPressSelectedItem = (item: IUser) => this.toggleUser(item);

	renderHeader = () => {
		const { theme } = this.props;
		return (
			<View style={{ backgroundColor: themes[theme].backgroundColor }}>
				<SearchBox onChangeText={(text: string) => this.onSearchChangeText(text)} testID='select-users-view-search' />
				{this.renderSelected()}
			</View>
		);
	};

	setFlatListRef = (ref: FlatList) => (this.flatlist = ref);

	onContentSizeChange = () => this.flatlist?.scrollToEnd({ animated: true });

	renderSelected = () => {
		const { users, theme } = this.props;

		if (users.length === 0) {
			return null;
		}

		return (
			<FlatList
				data={users}
				ref={this.setFlatListRef}
				onContentSizeChange={this.onContentSizeChange}
				getItemLayout={getItemLayout}
				keyExtractor={item => item._id}
				style={[sharedStyles.separatorTop, { borderColor: themes[theme].separatorColor }]}
				contentContainerStyle={{ marginVertical: 5 }}
				renderItem={this.renderSelectedItem}
				keyboardShouldPersistTaps='always'
				horizontal
			/>
		);
	};

	renderSelectedItem = ({ item }: { item: IUser }) => {
		const { theme } = this.props;
		return (
			<UserItem
				name={item.fname}
				username={item.name}
				onPress={() => this._onPressSelectedItem(item)}
				testID={`selected-user-${item.name}`}
				style={{ paddingRight: 15 }}
				theme={theme}
			/>
		);
	};

	renderItem = ({ item, index }: { item: IUser; index: number }) => {
		const { search, chats } = this.state;
		const { theme } = this.props;

		const name = item.search ? item.name : item.fname;
		const username = item.search ? item.username! : item.name;
		let style = { borderColor: themes[theme].separatorColor };
		if (index === 0) {
			style = { ...style, ...sharedStyles.separatorTop };
		}
		if (search.length > 0 && index === search.length - 1) {
			style = { ...style, ...sharedStyles.separatorBottom };
		}
		if (search.length === 0 && index === chats.length - 1) {
			style = { ...style, ...sharedStyles.separatorBottom };
		}
		return (
			<UserItem
				name={name}
				username={username}
				onPress={() => this._onPressItem(item._id, item)}
				testID={`select-users-view-item-${item.name}`}
				icon={this.isChecked(username) ? 'check' : null}
				style={style}
				theme={theme}
			/>
		);
	};

	renderList = () => {
		const { search, chats } = this.state;
		const { theme } = this.props;

		const data = (search.length > 0 ? search : chats)
			// filter DM between multiple users
			.filter(sub => !RocketChat.isGroupChat(sub));

		return (
			<FlatList
				data={data}
				extraData={this.props}
				keyExtractor={item => item._id}
				renderItem={this.renderItem}
				ItemSeparatorComponent={List.Separator}
				ListHeaderComponent={this.renderHeader}
				contentContainerStyle={{ backgroundColor: themes[theme].backgroundColor }}
				keyboardShouldPersistTaps='always'
			/>
		);
	};

	render = () => {
		const { loading } = this.props;
		return (
			<SafeAreaView testID='select-users-view'>
				<StatusBar />
				{this.renderList()}
				<Loading visible={loading} />
			</SafeAreaView>
		);
	};
}

const mapStateToProps = (state: any) => ({
	baseUrl: state.server.server,
	users: state.selectedUsers.users,
	loading: state.selectedUsers.loading,
	user: getUserSelector(state)
});

const mapDispatchToProps = (dispatch: any) => ({
	addUser: (user: any) => dispatch(addUserAction(user)),
	removeUser: (user: any) => dispatch(removeUserAction(user)),
	reset: () => dispatch(resetAction())
});

export default connect(mapStateToProps, mapDispatchToProps)(withTheme(SelectedUsersView));
