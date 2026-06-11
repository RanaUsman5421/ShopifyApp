import React from 'react'
import { NavLink } from 'react-router-dom'
import HomeIcon from '@mui/icons-material/Home';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import InventoryIcon from '@mui/icons-material/Inventory';
import SyncIcon from '@mui/icons-material/Sync';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoIcon from '@mui/icons-material/Info';
import BarChartIcon from '@mui/icons-material/BarChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import GroupIcon from '@mui/icons-material/Group';
import LinkIcon from '@mui/icons-material/Link';

export function NavigationBar() {
  return (
    <div className='navmenu-section'>
      <ul>
        <li title='Home'>
          <NavLink to="/" className={({isActive}) => isActive ? "active": ""}>
            <HomeIcon />
          </NavLink>
        </li>
        <li title='Orders'>
          <NavLink to="/orders" className={({isActive}) => isActive ? "active": ""}>
            <ShoppingCartIcon />
          </NavLink>
        </li>
        <li title='Link Store'>
          <NavLink to="/menu" className={({isActive}) => isActive ? "active": ""}>
            <InventoryIcon />
          </NavLink>
        </li>
        <li title='Sync Status'>
          <NavLink to="/search" className={({isActive}) => isActive ? "active": ""}>
            <SyncIcon />
          </NavLink>
        </li>
        <li title='Link Store'>
          <NavLink to="/linkstore" className={({isActive}) => isActive ? "active": ""}>
            <LinkIcon />
          </NavLink>
        </li>
        <li title='About us'>
          <NavLink to="/about" className={({isActive}) => isActive ? "active": ""}>
            <InfoIcon />
          </NavLink>
        </li>
        <li title='Graphs'>
          <NavLink to="/graph" className={({isActive}) => isActive ? "active": ""}>
            <BarChartIcon />
          </NavLink>
        </li>
        <li title='Statistics'>
          <NavLink to="/statistics" className={({isActive}) => isActive ? "active": ""}>
            <TrendingUpIcon />
          </NavLink>
        </li>
        <li title='Users'>
          <NavLink to="/user" className={({isActive}) => isActive ? "active": ""}>
            <GroupIcon />
          </NavLink>
        </li>
        <li title='Settings'>
          <NavLink to="/settings" className={({isActive}) => isActive ? "active": ""}>
            <SettingsIcon />
          </NavLink>
        </li>
      </ul>
    </div>
  )
}
